/**
 * "IS THIS CLOTH PRINTED, AND DOES ITS ROUTE PRINT IT?" — Fabric BOM ▸ Fabric
 * Process, client review 2026-09-19 (fixes 2 and 3).
 *
 * Client-safe on purpose (no `server-only`), like every rule file beside it:
 * the screen's Save gate, the server's guard, the picker narrowing and the
 * printing report all read these functions, and a rule the server states once
 * and the screen restates is a rule that drifts.
 *
 * ## WHAT "PRINTED" MEANS HERE, AND WHERE IT COMES FROM
 *
 * A print is declared PER PART on the order — Combos ▸ Structure Details, one
 * Fabric Print per (colourway, component), `garment_order_amendment_combo_
 * components.print_id` — and it reaches this BOM as each line's
 * `required_print` (text, 0495). There is no AOP-vs-placement field anywhere
 * in the schema: a "Roll form print" is fabric print by definition (a placement
 * print is a garment process, not a fabric one), so any `required_print` counts.
 *
 * THE LINE IS THE GRAIN, NOT THE ORDER. Until 2026-09-19 the print gate was one
 * order-wide boolean (`printDeclared`): if any colourway anywhere printed,
 * Printing was offered on every fabric's every branch, and nothing refused a
 * printed line whose route never printed. Both checkpoints the client asked
 * for are statements about a (fabric, colourway, component) leaf, so that is
 * what `printedGroup` answers.
 *
 * ## THE TWO CHECKPOINTS
 *
 * - **A — printed, but no Printing step.** "Print details exist in Order
 *   Entry, but Printing Process is missing." For every printed line, the steps
 *   that treat ITS colourway and component must include an `is_print` process.
 * - **B — a Printing step, but nothing printed.** "Block users from selecting
 *   a Printing Process if no print details were provided." The picker already
 *   withholds it per branch (`printDeclaredFor` on the grid); this is the half
 *   that refuses a route that already holds one.
 *
 * Both are SAVE BLOCKERS, the client's 2026-09-18 ruling for every route fault
 * ("block the save"), and both are sentences the screen and the server share.
 */

import { comboKey, stageCoversCombo } from "./yarn-process";

/** A BOM line, as much of it as the print rule reads. Structural, so the
 *  screen's `FabricBomLine` and the payload's line both fit unchanged. */
export type PrintLine = {
  item_id: string | null;
  combo?: string | null;
  component_id?: string | null;
  required_print?: string | null;
};

/** A route step, as much of it as the print rule reads. */
export type PrintRouteStep = {
  key?: string;
  item_id: string;
  combo?: string | null;
  component_id?: string | null;
  process_id?: string | null;
};

const printOf = (l: PrintLine) => (l.required_print ?? "").trim();

/**
 * IS THIS (FABRIC, COLOURWAY, COMPONENTS) GROUP PRINTED?
 *
 * True when any BOM line of that fabric, serving that colourway and one of
 * those components, carries a `required_print`.
 *
 * A BLANK `combo` MEANS "ANY COLOURWAY" and an empty `componentIds` means "any
 * component" — the unsplit route's reading, where one branch serves the whole
 * fabric: it prints if any of its lines prints. `comboKey` is the comparison,
 * the same one `stageCoversCombo` uses, so a lowercase or padded colourway is
 * the colourway the arithmetic means.
 */
export function printedGroup(
  lines: readonly PrintLine[],
  itemId: string,
  combo: string | null | undefined,
  componentIds: readonly (string | null | undefined)[] = [],
): boolean {
  const want = comboKey(combo);
  const panels = componentIds.filter((c): c is string => !!c);
  return lines.some(
    (l) =>
      l.item_id === itemId &&
      !!printOf(l) &&
      (want === "" || comboKey(l.combo) === want) &&
      (panels.length === 0 || (!!l.component_id && panels.includes(l.component_id))),
  );
}

/** Every distinct print name on the BOM's lines for one group — what the
 *  printing report prints under "Print". Sorted, so the cell reads the same
 *  on every render. */
export function printNamesFor(
  lines: readonly PrintLine[],
  itemId: string,
  combo: string | null | undefined,
  componentIds: readonly (string | null | undefined)[] = [],
): string[] {
  const want = comboKey(combo);
  const panels = componentIds.filter((c): c is string => !!c);
  const names = new Set<string>();
  for (const l of lines) {
    if (l.item_id !== itemId || !printOf(l)) continue;
    if (want !== "" && comboKey(l.combo) !== want) continue;
    if (panels.length && !(l.component_id && panels.includes(l.component_id))) continue;
    names.add(printOf(l));
  }
  return [...names].sort();
}

/**
 * The steps of one fabric's route that treat ONE LINE — its colourway and its
 * component. A step with no colour treats every colourway (`stageCoversCombo`)
 * and a step with no component treats every panel; the same reading
 * `stagesForGroup` makes, restated structurally because this file must not
 * need a loss figure to answer "is there a print step".
 */
function stepsTreating(
  route: readonly PrintRouteStep[],
  line: PrintLine,
): PrintRouteStep[] {
  const combo = comboKey(line.combo);
  return route.filter(
    (s) =>
      stageCoversCombo(s.combo ?? null, combo) &&
      (!s.component_id || s.component_id === line.component_id),
  );
}

export type PrintRouteProblem = {
  /** Which checkpoint spoke — asserted by the vectors, so a sentence cannot
   *  pass while the wrong rule produced it. */
  rule: "print-missing" | "print-unused";
  item_id: string;
  row_key: string | null;
  message: string;
};

/**
 * CHECKPOINTS A AND B, as sentences — one list the screen's Save gate and the
 * server's guard both read.
 *
 * `isPrint(processId)` answers from the PROCESS MASTER (`processes.is_print`):
 * the screen passes its loaded options, the server its own read of the master.
 * Never the payload's word for what a process is.
 *
 * `rows` are every fabric's route steps (any order); `lines` are the BOM's
 * fabric lines. Rows that name no process are ignored — a blank row is not a
 * step yet.
 */
export function printRouteProblems(
  rows: readonly PrintRouteStep[],
  lines: readonly PrintLine[],
  isPrint: (processId: string) => boolean,
  opts: {
    fabricName?: (itemId: string) => string;
    componentName?: (componentId: string) => string;
  } = {},
): PrintRouteProblem[] {
  const named = rows.filter((r) => !!r.process_id);
  const routeOf = new Map<string, PrintRouteStep[]>();
  for (const r of named) {
    const at = routeOf.get(r.item_id);
    if (at) at.push(r);
    else routeOf.set(r.item_id, [r]);
  }
  const fabric = (id: string) => opts.fabricName?.(id) ?? "This fabric";
  const component = (id: string | null | undefined) => (id ? (opts.componentName?.(id) ?? "") : "");
  const out: PrintRouteProblem[] = [];

  /* A — every printed line's own steps must include a print. Reported once per
     (fabric, colourway, component): three sizes of one printed panel are one
     missing step, not three. */
  const seenA = new Set<string>();
  for (const l of lines) {
    if (!l.item_id || !printOf(l)) continue;
    const key = JSON.stringify([l.item_id, comboKey(l.combo), l.component_id ?? ""]);
    if (seenA.has(key)) continue;
    seenA.add(key);
    const steps = stepsTreating(routeOf.get(l.item_id) ?? [], l);
    if (steps.some((s) => !!s.process_id && isPrint(s.process_id))) continue;
    const where = [comboKey(l.combo), component(l.component_id)].filter(Boolean).join(" / ");
    out.push({
      rule: "print-missing",
      item_id: l.item_id,
      row_key: null,
      message:
        `${fabric(l.item_id)}${where ? ` (${where})` : ""}: print details exist in Order Entry ` +
        `(${printOf(l)}), but its Fabric Process route has no Printing process. Add the Printing step, ` +
        `or remove the print on the order.`,
    });
  }

  /* B — a print step must serve at least one printed line of its own branch.
     A step with no colour / component serves the whole fabric, so it passes
     if ANY line of the fabric prints (`printedGroup` with blanks). */
  for (const r of named) {
    if (!isPrint(r.process_id as string)) continue;
    if (printedGroup(lines, r.item_id, r.combo, [r.component_id])) continue;
    const where = [comboKey(r.combo), component(r.component_id)].filter(Boolean).join(" / ");
    out.push({
      rule: "print-unused",
      item_id: r.item_id,
      row_key: r.key ?? null,
      message:
        `${fabric(r.item_id)}${where ? ` (${where})` : ""}: Printing is on the route, but Order Entry ` +
        `has no print for this fabric${where ? " / colour" : ""}. Remove the Printing step, or declare ` +
        `the print on the order first.`,
    });
  }
  return out;
}

/* ==========================================================================
 * THE PRINTING REQUIREMENT (client 2026-09-19, fix 2)
 *
 * "The Fabric BOM must generate a separate, dedicated printing requirement
 * report displaying the exact weight sent for printing."
 *
 * NOT A SECOND LADDER. The Yarn & Fabric Requirement Report already walks each
 * route and prints, per process, the weight entering and leaving each step
 * (`stageBreakdown`). A PRINTING section appears there on its own whenever a
 * route prints. What it could not do was ISOLATE: an unsplit route charged
 * every colourway through the printer. `routeForPrint` now removes the print
 * stage from an unprinted group's ladder, so the PRINTING section holds printed
 * groups only — and this report is that section, lifted out on its own with the
 * print named and totals added.
 *
 * Pure over the report's own rows, so a vector can pin it without Supabase.
 * ========================================================================== */

/** One printed group's weight through ONE print step. */
export type PrintRequirementRow = {
  processName: string;
  fabricName: string;
  combo: string;
  component: string;
  print: string;
  dia: string;
  /**
   * GARMENTS CUT from this printed group — Σ `basis_qty` over its requirement
   * rows (the cut quantity, allowances included). Client decision 2026-09-19
   * (1A): the printing weight keeps the engine's backward walk, and these two
   * columns are added so the printout shows what that weight rests on.
   * Optional so a row built before them (vectors) reads as "not stated".
   */
  cutPieces?: number | null;
  /** Kilograms of cloth per garment — Σ(basis × consumption) ÷ Σ basis, i.e.
   *  a piece-weighted average across sizes, BEFORE the cutting-room wastage
   *  (the weight columns beside it include that wastage and the print loss). */
  pieceWt?: number | null;
  lossPct: number;
  /** Cloth SENT to the printer — the step's input. */
  sentWt: number;
  /** Cloth coming BACK — the step's output. */
  receivedWt: number;
};

/**
 * GARMENTS CUT, COUNTED ONCE PER (STYLE, SIZE) — for `cutPieces` above.
 *
 * A body and its sleeves are often two Manual entries of one cloth, and each
 * entry's requirement rows carry the SAME garments. Summing `basis_qty` across
 * them would double the count (and halve the piece weight). So counts are kept
 * per (style, size) and two entries MERGE by taking the larger — while the
 * cloth weight beside them still sums across panels, since body + sleeves is
 * the garment's cloth.
 */
export function garmentKey(styleRefNo: string | null, sizeId: string | null): string {
  return JSON.stringify([styleRefNo ?? "", sizeId ?? ""]);
}

/** Fold `from` into `into`, keeping the larger count per (style, size). */
export function mergeGarmentCounts(into: Map<string, number>, from: ReadonlyMap<string, number>): void {
  for (const [k, q] of from) into.set(k, Math.max(into.get(k) ?? 0, q));
}

/** The garments a merged count stands for. */
export function garmentTotal(counts: ReadonlyMap<string, number>): number {
  let n = 0;
  for (const q of counts.values()) n += q;
  return n;
}

/** One colourway's subtotal, in the report's own order. */
export type PrintRequirementGroup = {
  combo: string;
  rows: PrintRequirementRow[];
  sentWt: number;
  receivedWt: number;
};

export type PrintRequirement = {
  groups: PrintRequirementGroup[];
  sentWt: number;
  receivedWt: number;
};

/**
 * Group print rows by colourway and total them. Rows arrive already in the
 * report's order (colour → component → fabric); the grouping keeps that order
 * and never re-sorts, so the printing report reads in the same sequence as
 * the requirement report it is lifted from.
 */
export function printRequirement(rows: readonly PrintRequirementRow[]): PrintRequirement {
  const groups: PrintRequirementGroup[] = [];
  const at = new Map<string, PrintRequirementGroup>();
  for (const r of rows) {
    let g = at.get(r.combo);
    if (!g) {
      g = { combo: r.combo, rows: [], sentWt: 0, receivedWt: 0 };
      at.set(r.combo, g);
      groups.push(g);
    }
    g.rows.push(r);
    g.sentWt += r.sentWt;
    g.receivedWt += r.receivedWt;
  }
  return {
    groups,
    sentWt: groups.reduce((a, g) => a + g.sentWt, 0),
    receivedWt: groups.reduce((a, g) => a + g.receivedWt, 0),
  };
}
