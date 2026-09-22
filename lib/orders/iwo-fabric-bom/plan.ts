/**
 * IWO Fabric BOM ▸ Fabric Consumption — DERIVED ROWS, one card per fabric
 * (user 2026-09-22, screenshot 3000; plan `piped-splashing-pixel`).
 *
 * ## THE ROWS ARE NOT TYPED — THEY ARE DERIVED FROM THE BOM'S OWN PANELS
 *
 * A fabric's consumption is planned per colour and per finish dia, and both
 * axes are already DECLARED on the Fabric BOM section: the Fabric Colour
 * panel and the Dia panel (per BOM, not per fabric — 0581 gives neither an
 * item id). So the consumption card of a coloured fabric shows one row per
 * (Fabric Colour × dia declared for the fabric's knit family) — PRINT adds the
 * Prints panel as a third axis — a GREIGE fabric one row per family dia, and
 * the operator types ONLY the weight. Nothing is added, nothing is removed:
 * add a colour to the panel and every coloured card grows a row; a weight
 * left blank is simply not stored. The same idiom as Yarn Process (rows from
 * `material_mixings`) and the order Manual grid's size rows (`manualSizeRows`,
 * `fabric-bom-screen.tsx`).
 *
 * This replaces the 09-21 "Plan by" attribute (Fabric · Colour · Dia · Colour
 * + Dia, with a [Breakup] sheet) — the Material BOM's shape, carried over
 * because the IWO has no order to explode by. The client's own screen
 * (recording 09-21, screenshot 2992) nests colours under the fabric and dias
 * under the colour; every combination on one card is that content flattened.
 *
 * ## ONE STORED LINE PER (FABRIC, COLOUR, DIA, PRINT) — UNCHANGED
 *
 * The stored grain is 0592/0599's and does not move: `iwo_fabric_bom_lines`
 * holds one row per (fabric, colour, dia, print) with its own `req_kgs`,
 * unique on the four. The rules in `lines.ts`, the yarn engine
 * (`iwoFabricGross`), the action, the Budget pull and the reports were all
 * written against that grain and are untouched. This file is the boundary:
 *
 *   - `expandPlanCells` — the card's weighted cells → the stored-line facts.
 *   - `foldPlanCells`   — stored lines → the card's cells, on load.
 *
 * ## CELLS ARE KEYED BY NAME, AND A LOST DECLARATION IS SHOWN, NEVER DROPPED
 *
 * `PlanCells` is a record keyed by the normalised (colour, dia, print) —
 * exactly `lines.ts`'s duplicate key minus the item — because that is what
 * the unique index is keyed on, and a panel row's screen key does not
 * survive a reload. A cell whose axes are no longer declared (a colour
 * deleted from the panel, a dia removed, the Stage switched to GREIGE) is
 * still a stored weight, so `derivePlanRows` keeps it on the card tagged
 * `declared: false` and Save refuses it by name. The alternative — dropping
 * the row because the panel changed — is 400 kg vanishing because a name was
 * retyped, which is the silent loss the order Manual grid's `declared: false`
 * rows exist to prevent.
 *
 * ## A FABRIC WITH NO WEIGHT STILL REACHES THE RULES
 *
 * The weight is not required per row (a derived row may legitimately be
 * unused, and a cursor hold on every blank combination would cage the
 * operator). The rule is per FABRIC — at least one weighted row — and it
 * needs no new rule: `expandPlanCells` of an empty card emits ONE placeholder
 * fact with `req_kgs: null`, so `iwoFabricLineProblems` refuses it with its
 * existing "enter the Req Wt" (which fires first — the rule order there is
 * weight, then colour, dia, print). The screen relabels that one sentence and
 * drops the placeholder's colour/dia/print problems, which are about a row
 * that does not exist. A placeholder never reaches the table.
 *
 * Client-safe, pure: the screen previews with these and `check:iwo-fabric-bom`
 * §18 proves them (derive, fold ∘ expand = identity both ways, the placeholder,
 * the undeclared cell, the stage merges).
 */

import { diaKey } from "@/lib/orders/fabric-bom/dia-knit";
import { comboKey } from "@/lib/orders/fabric-bom/yarn-process";

/** `${COLOUR}\0${DIA}\0${PRINT}` — `lines.ts`'s duplicate key without the item. */
export type CellKey = string;

export const cellKey = (colour: string | null | undefined, dia: string | null | undefined, print: string | null | undefined): CellKey =>
  [comboKey(colour), diaKey(dia), comboKey(print)].join("\u0000");

/** One weighted cell as the card edits it — the axes as DECLARED (capitals,
 *  like the panels), the weight as TYPED (text, so "12." is not rewritten
 *  under the caret). */
export type PlanCell = { color_name: string; finish_dia: string; print_name: string; req_kgs: string };

/** A fabric's weighted cells. A blank weight is an ABSENT key — that is what
 *  makes "a row left blank is not stored" fall out of `setPlanCell`. */
export type PlanCells = Readonly<Record<CellKey, PlanCell>>;

export const NO_CELLS: PlanCells = Object.freeze({});

/** What the panels declare for one fabric: its Stage's rank (`stageRank` — 0
 *  greige, 1 dyed/washed, 2 print, null while no Stage), the Fabric Colour
 *  names, the dias of its knit family (`familyDias`), the Prints names. */
export type PlanAxes = {
  rank: number | null;
  colours: readonly string[];
  dias: readonly string[];
  prints: readonly string[];
};

/** One row of the card. `declared` false = a stored weight whose axes the
 *  panels no longer name; shown after the declared rows, refused on Save. */
export type PlanDisplayRow = PlanCell & { key: CellKey; declared: boolean };

/** One stored line's plan fields, as `lines.ts` reads them. */
export type PlanFacts = {
  color_name: string | null;
  print_name: string | null;
  finish_dia: string | null;
  req_kgs: number | null;
};

/** A stored line as `foldPlanCells` reads it — numbers, as the DB holds them. */
export type StoredPlanLine = {
  color_name: string | null;
  print_name: string | null;
  finish_dia: string | null;
  req_kgs: number | null;
};

const num = (v: string): number | null => {
  const t = v.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const text = (v: string): string | null => v.trim() || null;
const str = (n: number | null | undefined): string => (n == null ? "" : String(n));

/** One Dia panel row as this file reads it. */
export type DiaDeclaration = { knit_type: string | null | undefined; dia: string | null | undefined };

/**
 * THE DIAS A FABRIC IS OFFERED — those declared under its knit family, each
 * once (`diaKey`: circular 60 and woven 60 are one "60"), in panel order. A
 * fabric with no family (no structure yet) sees every declared dia — the
 * `diaOptionsFor` rule, and the one `diaKnitProblem` also stands down on. An
 * UNTYPED dia is not offered to a typed fabric (the same rule).
 */
export function familyDias(decls: readonly DiaDeclaration[], knit: string | null): string[] {
  const out: string[] = [];
  for (const d of decls) {
    const key = diaKey(d.dia);
    if (!key) continue;
    if (knit != null && d.knit_type !== knit) continue;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * THE CARD'S ROWS. Declared rows first, in panel order — colour-major, then
 * dia, then print (rank 2 only) — each carrying the weight its cell holds;
 * then every cell the declaration no longer names, tagged `declared: false`.
 *
 *   rank ≥ 1 — colours × dias (× prints at rank 2; no prints → no rows, the
 *              card says which panel to fill);
 *   rank 0   — dias only, greige has no colour; no dia declared → ONE row with
 *              a blank dia (`lines.ts` lets a greige line go without one);
 *   rank null — no declared rows: the Stage's own hold says what is missing.
 */
export function derivePlanRows(cells: PlanCells, axes: PlanAxes): PlanDisplayRow[] {
  const declared: PlanDisplayRow[] = [];
  const seen = new Set<CellKey>();
  const push = (colour: string, dia: string, print: string) => {
    const key = cellKey(colour, dia, print);
    if (seen.has(key)) return;
    seen.add(key);
    const held = cells[key];
    declared.push({
      key,
      declared: true,
      color_name: held?.color_name ?? colour,
      finish_dia: held?.finish_dia ?? dia,
      print_name: held?.print_name ?? print,
      req_kgs: held?.req_kgs ?? "",
    });
  };
  if (axes.rank === 0) {
    if (axes.dias.length === 0) push("", "", "");
    for (const dia of axes.dias) push("", dia, "");
  } else if (axes.rank != null) {
    const prints = axes.rank === 2 ? axes.prints : [""];
    for (const colour of axes.colours) for (const dia of axes.dias) for (const print of prints) push(colour, dia, print);
  }
  const stale: PlanDisplayRow[] = [];
  for (const [key, c] of Object.entries(cells)) {
    if (!seen.has(key)) stale.push({ ...c, key, declared: false });
  }
  return [...declared, ...stale];
}

/** The card's rows the panels no longer name — the message, and the blocker. */
export const stalePlanRows = (cells: PlanCells, axes: PlanAxes): PlanDisplayRow[] =>
  derivePlanRows(cells, axes).filter((r) => !r.declared);

/**
 * A KEYSTROKE ON A ROW'S WEIGHT. The first materialises the cell from the
 * row's own axes (the order Manual grid's `setSizeCell`); a blank removes the
 * key — which is also how an undeclared row is cleared.
 */
export function setPlanCell(cells: PlanCells, row: Pick<PlanDisplayRow, "key" | "color_name" | "finish_dia" | "print_name">, req_kgs: string): PlanCells {
  if (req_kgs.trim() === "") {
    if (!(row.key in cells)) return cells;
    const next: Record<CellKey, PlanCell> = { ...cells };
    delete next[row.key];
    return next;
  }
  return { ...cells, [row.key]: { color_name: row.color_name, finish_dia: row.finish_dia, print_name: row.print_name, req_kgs } };
}

/** The one placeholder an empty card expands to — see the header. */
export const isPlaceholderFacts = (f: Pick<PlanFacts, "req_kgs">): boolean => f.req_kgs === null;

/**
 * THE CARD'S CELLS → THE STORED-LINE FACTS, one per weighted cell in cell
 * order. NO cells → exactly one placeholder with every field null, so the
 * fabric still reaches the payload, the engine and the rules — a `[]` here
 * would make a fabric with no weight vanish rather than be refused.
 */
export function expandPlanCells(cells: PlanCells): PlanFacts[] {
  const out: PlanFacts[] = [];
  for (const c of Object.values(cells)) {
    out.push({ color_name: text(c.color_name), print_name: text(c.print_name), finish_dia: text(c.finish_dia), req_kgs: num(c.req_kgs) });
  }
  return out.length ? out : [{ color_name: null, print_name: null, finish_dia: null, req_kgs: null }];
}

/**
 * STORED LINES OF ONE FABRIC → THE CARD'S CELLS. Keyed by the normalised
 * axes, the cell keeping the stored spelling; a line with no weight cannot
 * exist (the action runs the rules on drafts too) and is skipped rather than
 * stored as a blank.
 */
export function foldPlanCells(lines: readonly StoredPlanLine[]): PlanCells {
  const out: Record<CellKey, PlanCell> = {};
  for (const r of lines) {
    if (r.req_kgs == null) continue;
    out[cellKey(r.color_name, r.finish_dia, r.print_name)] = {
      color_name: r.color_name ?? "",
      finish_dia: r.finish_dia ?? "",
      print_name: r.print_name ?? "",
      req_kgs: str(r.req_kgs),
    };
  }
  return out;
}

/** Merge cells that share `keyOf`, summing their weights (a non-number typed
 *  poisons the sum to NaN, refused by name downstream). */
function mergeCells(cells: PlanCells, keyOf: (c: PlanCell) => CellKey, strip: (c: PlanCell) => PlanCell): PlanCells {
  const out: Record<CellKey, PlanCell> = {};
  for (const c of Object.values(cells)) {
    const key = keyOf(c);
    const held = out[key];
    if (held) {
      const sum = (num(held.req_kgs) ?? 0) + (num(c.req_kgs) ?? 0);
      held.req_kgs = Number.isFinite(sum) ? String(Number(sum.toFixed(4))) : String(sum);
    } else out[key] = strip(c);
  }
  return out;
}

/**
 * THE STAGE CHANGED — A WEIGHT IS NEVER THROWN AWAY (the 09-21 rule). To
 * GREIGE (rank 0): greige is one lot, so cells that share a dia MERGE and
 * their weights SUM. Off a Print stage (rank ≠ 2): cells that share a colour
 * and dia merge across prints. GREIGE → coloured is the identity — a greige
 * cell has no colour to gain, so `derivePlanRows` shows it as not declared
 * until the weight is retyped per colour.
 */
export function planCellsForStage(cells: PlanCells, rank: number | null): PlanCells {
  let next = cells;
  if (rank === 0) {
    next = mergeCells(
      next,
      (c) => cellKey("", c.finish_dia, ""),
      (c) => ({ ...c, color_name: "", print_name: "" }),
    );
  } else if (rank !== 2) {
    next = mergeCells(
      next,
      (c) => cellKey(c.color_name, c.finish_dia, ""),
      (c) => ({ ...c, print_name: "" }),
    );
  }
  return next;
}

/**
 * THE FABRIC'S REQ WT — the sum of its weighted cells, one reader for the
 * Save gate, the section dot and the totals. NULL while no cell carries a
 * weight, so "enter a weight" fires rather than 0 reading as an answer. NaN
 * (a non-number typed) passes through, refused by name downstream.
 */
export function planReqKgs(cells: PlanCells): number | null {
  const ns = Object.values(cells)
    .map((c) => num(c.req_kgs))
    .filter((n): n is number => n != null);
  if (ns.length === 0) return null;
  const sum = ns.reduce((a, b) => a + b, 0);
  return Number.isFinite(sum) ? Number(sum.toFixed(4)) : sum;
}

/** The colours a fabric's weighted cells name — the `iwoFabricGross` buckets,
 *  and what a COLOR WISE loss step lists. */
export function plannedColours(cells: PlanCells): string[] {
  return [...new Set(Object.values(cells).map((c) => comboKey(c.color_name)).filter(Boolean))];
}
