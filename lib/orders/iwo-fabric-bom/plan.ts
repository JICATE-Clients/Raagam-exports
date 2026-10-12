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
export type PlanCell = {
  color_name: string;
  finish_dia: string;
  print_name: string;
  req_kgs: string;
  /** Sample Fabric Plan (0707): the SWO sample style (SMP line) the row is
   *  for — "" when none. Optional so a production card never has to say it. */
  sample_style_id?: string;
  /** "+ Add Dia" (client 2026-10-12): this row is a further Finish Dia of the
   *  row above — same SMP, Colour and Print, shown once on the head row and
   *  never re-picked here. A HINT, not a link: the row only reads as a
   *  continuation while its SMP / Colour / Print still equal the row above
   *  (`derivePlanRows`), so a removal or a Stage merge can never strand one
   *  under the wrong colour. Not stored — the stored grain is unchanged, and
   *  `foldPlanCells` re-derives it from adjacent lines on load. */
  sub?: boolean;
  /** Sample Fabric Plan (0714): the garment part this dia is for (FRONT +
   *  BACK, SLEEVE, RIB NECK). Stored; absent on a production card. */
  part?: string;
  /** Sample Fabric Plan, sample-first view (2026-10-12): which "fabric row"
   *  of a sample this dia belongs to — the rows of one (SMP, fabric, colour,
   *  print) entered through one Dia & weight popup. Client-only, never
   *  stored: a loaded cell has none and is grouped by its SMP / Colour /
   *  Print (`grpOf`). */
  grp?: string;
};

/** The row's SMP, "" when none. */
const smpOf = (c: PlanCell) => c.sample_style_id ?? "";
/** The merge key's fifth part — empty without an SMP, so a production card's
 *  merged rows keep the keys they always had. */
const smpSuffix = (c: PlanCell) =>
  (smpOf(c) ? "\u0000" + smpOf(c) : "") +
  // …and per PART (0714): a sleeve's weight is never summed into the body's.
  (c.part?.trim() ? "\u0000p" + comboKey(c.part) : "");
/** What a dia sub-row shares with its head — SMP, Colour, Print. */
const runKey = (c: PlanCell) => [smpOf(c), comboKey(c.color_name), comboKey(c.print_name)].join("\u0000");
/** Does this run name anything a dia could be added under? */
const runNamed = (c: PlanCell) => !!(smpOf(c) || c.color_name.trim() || c.print_name.trim());

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
  /** An SWO's sample styles (0707) — what the SMP No picker offers. Absent on
   *  a production IWO, where the row has no SMP to judge. */
  samples?: readonly string[];
};

/** One row of the card. `declared` false = a row holding a colour / dia /
 *  print the panels no longer name; shown, tagged, refused on Save. */
export type PlanDisplayRow = PlanCell & {
  key: CellKey;
  declared: boolean;
  /** A further dia of the row above (`sub` AND the same SMP / Colour / Print):
   *  its SMP, Colour and Print are the head's, shown once, not re-picked. */
  follows: boolean;
  /** The last row of its SMP / Colour / Print run — where "+ Add Dia" sits. */
  runEnd: boolean;
};

/** One stored line's plan fields, as `lines.ts` reads them. */
export type PlanFacts = {
  color_name: string | null;
  print_name: string | null;
  finish_dia: string | null;
  req_kgs: number | null;
  sample_style_id?: string | null;
  part?: string | null;
};

/** A stored line as `foldPlanCells` reads it — numbers, as the DB holds them. */
export type StoredPlanLine = {
  color_name: string | null;
  print_name: string | null;
  finish_dia: string | null;
  req_kgs: number | null;
  sample_style_id?: string | null;
  part?: string | null;
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
  const smpOk = !axes.samples || !smpOf(c) || axes.samples.includes(smpOf(c));
  return colourOk && printOk && smpOk && inList(c.finish_dia, axes.dias, diaKey);
}

// No `sample_style_id` key: a production card's cells keep 0599's exact shape.
const BLANK_CELL: PlanCell = { color_name: "", finish_dia: "", print_name: "", req_kgs: "" };

/**
 * THE CARD'S ROWS, in the order they were added — NEVER a cross product. An
 * empty card is ONE seeded blank row (`SEED_ROW_KEY`); nothing on it is
 * pre-filled.
 */
export function derivePlanRows(cells: PlanCells, axes: PlanAxes): PlanDisplayRow[] {
  const entries = Object.entries(cells);
  if (entries.length === 0) return [{ ...BLANK_CELL, key: SEED_ROW_KEY, declared: true, follows: false, runEnd: true }];
  const follows = entries.map(([, c], i) => i > 0 && !!c.sub && runKey(c) === runKey(entries[i - 1][1]));
  return entries.map(([key, c], i) => ({
    ...c,
    key,
    declared: isDeclared(c, axes),
    follows: follows[i],
    runEnd: !follows[i + 1],
  }));
}

/** The rows a head row's SMP / Colour / Print stand for — itself and the dia
 *  sub-rows straight after it. */
function runOf(cells: PlanCells, key: CellKey): CellKey[] {
  const keys = Object.keys(cells);
  const at = keys.indexOf(key);
  if (at < 0) return [key];
  const out = [key];
  for (let i = at + 1; i < keys.length; i++) {
    const c = cells[keys[i]];
    if (!c.sub || runKey(c) !== runKey(cells[keys[i - 1]])) break;
    out.push(keys[i]);
  }
  return out;
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
  const next: Record<CellKey, PlanCell> = { ...cells, [row.key]: { ...held, ...patch } };
  /* A HEAD'S SMP / COLOUR / PRINT ARE ITS DIA SUB-ROWS' TOO — re-picked once
     on the head, carried to every dia under it, so the run never splits. */
  const shared: Partial<PlanCell> = {};
  if ("sample_style_id" in patch) shared.sample_style_id = patch.sample_style_id;
  if ("color_name" in patch) shared.color_name = patch.color_name;
  if ("print_name" in patch) shared.print_name = patch.print_name;
  if (Object.keys(shared).length && row.key in cells) {
    for (const k of runOf(cells, row.key).slice(1)) next[k] = { ...next[k], ...shared };
  }
  return next;
}

/**
 * "+ Add Dia" (client 2026-10-12: Navy Blue needing both 30" Open Width and
 * 24" Tubular, without re-selecting Navy Blue) — a new row carrying the run's
 * SMP, Colour and Print, its Finish Dia and weight blank, placed straight after
 * the run's last dia. Still one stored line per (colour, dia, print, SMP), so
 * every reader downstream — rules, yarn engine, dyeing order, Grouping's
 * cutting basis — is untouched.
 */
export function addPlanDia(cells: PlanCells, key: CellKey): PlanCells {
  const base: PlanCells = Object.keys(cells).length ? cells : { [SEED_ROW_KEY]: BLANK_CELL };
  const head = base[key];
  if (!head) return base;
  const run = runOf(base, key);
  const last = run[run.length - 1];
  let n = Object.keys(base).length;
  while (`r${n}` in base) n++;
  const added: PlanCell = {
    ...BLANK_CELL,
    color_name: head.color_name,
    print_name: head.print_name,
    ...(smpOf(head) ? { sample_style_id: smpOf(head) } : {}),
    sub: true,
  };
  const out: Record<CellKey, PlanCell> = {};
  for (const [k, c] of Object.entries(base)) {
    out[k] = c;
    if (k === last) out[`r${n}`] = added;
  }
  return out;
}

/** Can "+ Add Dia" be offered under this row — does its run name an SMP, a
 *  Colour or a Print to carry? A bare row has nothing; that is "+ Add row". */
export const canAddDia = (c: PlanCell): boolean => runNamed(c);

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
  !c.color_name.trim() && !c.finish_dia.trim() && !c.print_name.trim() && !c.req_kgs.trim() && !smpOf(c) && !c.part?.trim();

/** The one placeholder an empty card expands to — every field null (a row with
 *  a dia and no weight is a real line, refused by name). */
export const isPlaceholderFacts = (f: {
  req_kgs?: number | null;
  color_name?: string | null;
  finish_dia?: string | null;
  print_name?: string | null;
  sample_style_id?: string | null;
  part?: string | null;
}): boolean =>
  f.req_kgs == null && f.color_name == null && f.finish_dia == null && f.print_name == null && f.sample_style_id == null && f.part == null;

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
    out.push({
      color_name: text(c.color_name),
      print_name: text(c.print_name),
      finish_dia: text(c.finish_dia),
      req_kgs: num(c.req_kgs),
      sample_style_id: smpOf(c) || null,
      // Only a sample card's cell carries a part key (0714) — a production
      // card's facts keep 0707's exact shape.
      ...("part" in c ? { part: text(c.part ?? "") } : {}),
    });
  }
  return out.length ? out : [{ color_name: null, print_name: null, finish_dia: null, req_kgs: null, sample_style_id: null }];
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
    const cell: PlanCell = {
      color_name: r.color_name ?? "",
      finish_dia: r.finish_dia ?? "",
      print_name: r.print_name ?? "",
      req_kgs: str(r.req_kgs),
      // Only an SWO's line carries the key (0707) — a production fold is unchanged.
      ...(r.sample_style_id ? { sample_style_id: r.sample_style_id } : {}),
      ...(r.part ? { part: r.part } : {}),
    };
    /* A line straight after one of the same SMP / Colour / Print is a further
       dia of it — the save writes a card's rows in order (`sno`), so a run
       comes back as it was typed. Only a NAMED run folds: two greige lines
       holding nothing but a dia stay two rows. */
    const prev = i > 0 ? out[`s${i - 1}`] : undefined;
    if (prev && runNamed(cell) && runKey(prev) === runKey(cell)) cell.sub = true;
    out[`s${i++}`] = cell;
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
      // Merged per SMP (0707): two samples' weights are never summed into one.
      (c) => cellKey("", c.finish_dia, "") + smpSuffix(c),
      (c) => ({ ...c, color_name: "", print_name: "" }),
    );
  } else if (rank !== 2) {
    next = mergeCells(
      next,
      (c) => cellKey(c.color_name, c.finish_dia, "") + smpSuffix(c),
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

// ---------------------------------------------------------------------------
// THE SAMPLE-FIRST VIEW (user 2026-10-12, plan "SMP-wise Fabric Consumption")
// ---------------------------------------------------------------------------
//
// A sample plan is entered SAMPLE BY SAMPLE: pick an SMP, list the fabrics it
// takes (one row per fabric · colour · print), and give each row its dias and
// weights in a popup — Part · Finish Dia · Weight. The per-fabric `cells`
// above stay the model (one cell per dia, one stored line per cell), so the
// rules, the yarn engine, the save and every reader are untouched; these
// helpers only read and edit one sample's slice of one fabric's cells.

/** The fabric row a dia belongs to: its explicit `grp`, else its SMP /
 *  Colour / Print (a loaded line has no `grp`). */
export const grpOf = (c: PlanCell): string => c.grp ?? runKey(c);

/** One sample's fabric row on one fabric — the cells (one per dia) entered
 *  through one popup, with the Colour / Print they share. */
export type SmpGroup = { grp: string; keys: CellKey[]; color_name: string; print_name: string };

/** A sample's fabric rows on one fabric, in the order their first dia was added. */
export function smpGroups(cells: PlanCells, smp: string): SmpGroup[] {
  const out: SmpGroup[] = [];
  const at = new Map<string, SmpGroup>();
  for (const [key, c] of Object.entries(cells)) {
    if (smpOf(c) !== smp) continue;
    const g = grpOf(c);
    const held = at.get(g);
    if (held) held.keys.push(key);
    else {
      const next: SmpGroup = { grp: g, keys: [key], color_name: c.color_name, print_name: c.print_name };
      at.set(g, next);
      out.push(next);
    }
  }
  return out;
}

const freshKey = (cells: PlanCells): CellKey => {
  let n = Object.keys(cells).length;
  while (`r${n}` in cells) n++;
  return `r${n}`;
};

/** "+ Add fabric" for a sample — a new fabric row holding ONE blank dia, so
 *  the popup never opens on a bare "+ Add". Returns the new row's `grp`. */
export function addSmpGroup(cells: PlanCells, smp: string): { cells: PlanCells; grp: string } {
  const key = freshKey(cells);
  const grp = `g:${key}`;
  return { cells: { ...cells, [key]: { ...BLANK_CELL, sample_style_id: smp, part: "", grp } }, grp };
}

/** "+ Add dia" inside the popup — a new dia carrying the row's SMP, Colour
 *  and Print, placed after the row's last dia. */
export function addSmpDia(cells: PlanCells, grp: string): PlanCells {
  const entries = Object.entries(cells);
  const members = entries.filter(([, c]) => grpOf(c) === grp);
  if (!members.length) return cells;
  const [lastKey, head] = members[members.length - 1];
  const key = freshKey(cells);
  const added: PlanCell = {
    ...BLANK_CELL,
    color_name: head.color_name,
    print_name: head.print_name,
    sample_style_id: smpOf(head),
    part: "",
    grp,
  };
  const out: Record<CellKey, PlanCell> = {};
  for (const [k, c] of entries) {
    out[k] = c;
    if (k === lastKey) out[key] = added;
  }
  return out;
}

/** The row's Colour / Print, set on every dia of it. Each member is pinned
 *  to the row's `grp` first, so a loaded row (grouped by its colour) stays
 *  one row while its colour changes. */
export function patchSmpGroup(cells: PlanCells, grp: string, patch: Pick<Partial<PlanCell>, "color_name" | "print_name">): PlanCells {
  const out: Record<CellKey, PlanCell> = {};
  for (const [k, c] of Object.entries(cells)) out[k] = grpOf(c) === grp ? { ...c, grp, ...patch } : c;
  return out;
}

/** One dia's Part / Finish Dia / Weight. */
export function patchSmpDia(cells: PlanCells, key: CellKey, patch: Pick<Partial<PlanCell>, "part" | "finish_dia" | "req_kgs">): PlanCells {
  const held = cells[key];
  if (!held) return cells;
  return { ...cells, [key]: { ...held, grp: grpOf(held), ...patch } };
}

/** ✕ on a dia in the popup. The row's last dia is never removed this way — a
 *  row with no dia would vanish from the sample; remove the row instead. */
export function removeSmpDia(cells: PlanCells, key: CellKey): PlanCells {
  const held = cells[key];
  if (!held) return cells;
  const g = grpOf(held);
  if (Object.values(cells).filter((c) => grpOf(c) === g).length <= 1) return cells;
  const next: Record<CellKey, PlanCell> = { ...cells };
  delete next[key];
  return next;
}

/** ✕ on a sample's fabric row — every dia of it goes. */
export function removeSmpGroup(cells: PlanCells, grp: string): PlanCells {
  const out: Record<CellKey, PlanCell> = {};
  for (const [k, c] of Object.entries(cells)) if (grpOf(c) !== grp) out[k] = c;
  return out;
}

/** A sample's planned kg across every fabric — the rail's "planned of costing". */
export function smpReqKgs(cellsByFabric: readonly PlanCells[], smp: string): number {
  let sum = 0;
  for (const cells of cellsByFabric) for (const c of Object.values(cells)) if (smpOf(c) === smp) sum += num(c.req_kgs) ?? 0;
  return Number.isFinite(sum) ? Number(sum.toFixed(4)) : 0;
}
