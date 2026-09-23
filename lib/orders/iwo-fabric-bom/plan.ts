/**
 * IWO Fabric BOM ▸ Fabric Consumption — ROWS THE OPERATOR ADDS, one card per
 * fabric, each row's Colour / Finish Dia / Print PICKED from what the panels
 * declare (user, 2026-09-23: "in fabric consumption there is one error, the
 * dia auto derivation" — "it should be a field cell for it").
 *
 * ## THE ROWS ARE NO LONGER DERIVED — AND WHY THAT REVERSES 09-22
 *
 * From 2026-09-22 (screenshot 3000) the card DERIVED its rows: one per
 * (Fabric Colour × every dia declared for the fabric's knit family), × Prints
 * on a PRINT stage, and the operator typed only the weight. That put every
 * declared dia on every fabric whether it was cut at that dia or not — a dia
 * nobody chose, standing on the card as if it were planned. The user called
 * that the error, so the axes are now CELLS: the card opens on ONE blank row
 * (AGENTS.md, editable sub-tables open with a row), "+ Add" adds another, and
 * each row's Colour, Finish Dia and Print are pickers.
 *
 * WHAT DID NOT MOVE is the part that was right: the pickers offer ONLY what
 * the panels declare (`PlanAxes` — the Fabric Colour names, the dias of the
 * fabric's knit family via `familyDias`, the Prints names), nothing is ever
 * pre-filled — not even where exactly one dia is declared — and Gross Yarn is
 * still derived from the typed weight. A row holding a value the panels no
 * longer name is still shown, tagged `declared: false`, and refused on Save by
 * name — never silently dropped.
 *
 * Rows are keyed by an opaque ROW key, not by their axes, because the axes are
 * now edited in place: a key made of the colour would change under the cursor
 * on every pick. Two rows naming the same (colour, dia, print) are the
 * duplicate `lines.ts` already refuses by name.
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
 * ## A FABRIC WITH NO WEIGHT STILL REACHES THE RULES
 *
 * A row with NOTHING in it (the blank row the card opens on) is not a line
 * and is skipped. A card with no line at all expands to ONE placeholder fact
 * — every field null — so `iwoFabricLineProblems` refuses the fabric with its
 * existing "enter the Req Wt"; the screen rewords that one sentence and drops
 * the placeholder's colour/dia/print problems. A row with a dia picked and no
 * weight is NOT a placeholder: it reaches the rules as itself and is refused
 * "enter the Req Wt" by name, rather than vanishing on Save.
 *
 * Client-safe, pure: the screen previews with these and `check:iwo-fabric-bom`
 * §18 proves them (the seeded row, add / edit / remove, fold ∘ expand =
 * identity, the placeholder, the undeclared value, the stage merges).
 */

import { diaKey } from "@/lib/orders/fabric-bom/dia-knit";
import { comboKey } from "@/lib/orders/fabric-bom/yarn-process";

/** A row's identity on the card — opaque, stable while its axes are edited.
 *  `cellKey` below is the separate (colour, dia, print) identity the Stage
 *  merge compares by (`lines.ts`'s duplicate key without the item). */
export type CellKey = string;

/** The key of the blank row an empty card opens on. */
export const SEED_ROW_KEY: CellKey = "seed";

export const cellKey = (colour: string | null | undefined, dia: string | null | undefined, print: string | null | undefined): CellKey =>
  [comboKey(colour), diaKey(dia), comboKey(print)].join("\u0000");

/** One weighted cell as the card edits it — the axes as DECLARED (capitals,
 *  like the panels), the weight as TYPED (text, so "12." is not rewritten
 *  under the caret). */
export type PlanCell = { color_name: string; finish_dia: string; print_name: string; req_kgs: string };

/** A fabric's rows, by row key. Empty = the card shows its one seeded blank
 *  row, which becomes a real row on the first pick or keystroke. */
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

/** One row of the card. `declared` false = a row holding a colour / dia /
 *  print the panels no longer name; shown, tagged, refused on Save. */
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

const inList = (v: string, list: readonly string[], key: (x: string) => string) =>
  !v.trim() || list.some((x) => key(x) === key(v));

/** Does every value this row holds belong to what the panels declare? A blank
 *  is "not chosen yet" (the rules ask for it), never "undeclared". No Stage →
 *  nothing to judge by yet: the Stage's own hold speaks first. */
function isDeclared(c: PlanCell, axes: PlanAxes): boolean {
  if (axes.rank == null) return true;
  const colourOk = axes.rank === 0 ? true : inList(c.color_name, axes.colours, comboKey);
  const printOk = axes.rank === 2 ? inList(c.print_name, axes.prints, comboKey) : true;
  return colourOk && printOk && inList(c.finish_dia, axes.dias, diaKey);
}

const BLANK_CELL: PlanCell = { color_name: "", finish_dia: "", print_name: "", req_kgs: "" };

/**
 * THE CARD'S ROWS, in the order they were added — NEVER a cross product. An
 * empty card is ONE seeded blank row (`SEED_ROW_KEY`); nothing on it is
 * pre-filled.
 */
export function derivePlanRows(cells: PlanCells, axes: PlanAxes): PlanDisplayRow[] {
  const entries = Object.entries(cells);
  if (entries.length === 0) return [{ ...BLANK_CELL, key: SEED_ROW_KEY, declared: true }];
  return entries.map(([key, c]) => ({ ...c, key, declared: isDeclared(c, axes) }));
}

/** The card's rows the panels no longer name — the message, and the blocker. */
export const stalePlanRows = (cells: PlanCells, axes: PlanAxes): PlanDisplayRow[] =>
  derivePlanRows(cells, axes).filter((r) => !r.declared);

/**
 * AN EDIT ON ONE ROW — a pick of Colour / Finish Dia / Print, or a keystroke on
 * the weight. The seeded row materialises on its first edit under its own key,
 * so the cursor stays on the row it is in.
 */
export function setPlanCell(cells: PlanCells, row: Pick<PlanDisplayRow, "key">, patch: Partial<PlanCell>): PlanCells {
  const held = cells[row.key] ?? BLANK_CELL;
  return { ...cells, [row.key]: { ...held, ...patch } };
}

/** "+ Add" — a new blank row, AFTER the seeded one if the card was empty (the
 *  operator may already be standing in it). Keys `r1`, `r2`, … never reused
 *  while the card holds them. */
export function addPlanRow(cells: PlanCells): PlanCells {
  const base: PlanCells = Object.keys(cells).length ? cells : { [SEED_ROW_KEY]: BLANK_CELL };
  let n = Object.keys(base).length;
  while (`r${n}` in base) n++;
  return { ...base, [`r${n}`]: BLANK_CELL };
}

/** ✕ / Ctrl+Del — the row goes. The last one going leaves the seeded blank
 *  row in its place: a card never renders empty. */
export function removePlanRow(cells: PlanCells, key: CellKey): PlanCells {
  if (!(key in cells)) return cells;
  const next: Record<CellKey, PlanCell> = { ...cells };
  delete next[key];
  return next;
}

const isBlankCell = (c: PlanCell) =>
  !c.color_name.trim() && !c.finish_dia.trim() && !c.print_name.trim() && !c.req_kgs.trim();

/** The one placeholder an empty card expands to — every field null (a row with
 *  a dia and no weight is a real line, refused by name). */
export const isPlaceholderFacts = (f: {
  req_kgs?: number | null;
  color_name?: string | null;
  finish_dia?: string | null;
  print_name?: string | null;
}): boolean => f.req_kgs == null && f.color_name == null && f.finish_dia == null && f.print_name == null;

/**
 * THE CARD'S ROWS → THE STORED-LINE FACTS, one per row that holds anything, in
 * row order. A wholly blank row is skipped. NO line → exactly one placeholder
 * with every field null, so the fabric still reaches the payload, the engine
 * and the rules — a `[]` here would make a fabric with no weight vanish rather
 * than be refused.
 */
export function expandPlanCells(cells: PlanCells): PlanFacts[] {
  const out: PlanFacts[] = [];
  for (const c of Object.values(cells)) {
    if (isBlankCell(c)) continue;
    out.push({ color_name: text(c.color_name), print_name: text(c.print_name), finish_dia: text(c.finish_dia), req_kgs: num(c.req_kgs) });
  }
  return out.length ? out : [{ color_name: null, print_name: null, finish_dia: null, req_kgs: null }];
}

/**
 * STORED LINES OF ONE FABRIC → THE CARD'S ROWS, in stored order, keyed `s0`,
 * `s1`, …, keeping the stored spelling. A line with no weight cannot exist (the
 * action runs the rules on drafts too) and is skipped.
 */
export function foldPlanCells(lines: readonly StoredPlanLine[]): PlanCells {
  const out: Record<CellKey, PlanCell> = {};
  let i = 0;
  for (const r of lines) {
    if (r.req_kgs == null) continue;
    out[`s${i++}`] = {
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
      const a = num(held.req_kgs);
      const b = num(c.req_kgs);
      // Two blank weights stay blank — a merge never invents a 0.
      if (a == null && b == null) continue;
      const sum = (a ?? 0) + (b ?? 0);
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
 * row has no colour to gain; its Colour cell is blank, so the rules ask for
 * one on that row. Merged rows are re-keyed by their (colour, dia, print).
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
