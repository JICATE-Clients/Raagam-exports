/**
 * Packing List Advice — the line rules, ONCE (0579, doc/order/packing list.md).
 *
 * Pure functions, no server imports: the screen reads them for its Save gate and
 * the action reads them again before it writes, so the Save button can never
 * allow what the server then refuses (the IWO's `lines.ts` shape).
 *
 * ## THE BLANK-ROW FILTER TESTS ONLY WHAT THE OPERATOR TYPES
 *
 * The grid opens with one seeded row and that row reaches the action, so a row
 * with nothing filled is dropped. Every clause reads a field the operator
 * enters; the seed stamps nothing, so no clause is the constant `true`.
 */

import { styleKey } from "@/lib/orders/amendments/style-key";
import { ASSORTMENT_TYPE_LABELS, type AssortmentType } from "./types";

/** A line as the rules see it — numbers already parsed (NaN = typed, not a number). */
export type PackingLineDraft = {
  style_ref_no: string | null;
  combo: string | null;
  from_carton_no: number | null;
  to_carton_no: number | null;
  assortment_type: AssortmentType | null;
  pcs_per_carton: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  gross_weight: number | null;
  net_weight: number | null;
};

/**
 * One thing wrong, and which line (1-based, as the operator counts) it is on.
 *
 * `advisory` is said but never blocks: neither the Save gate nor the action
 * reads it (`blockingProblems`). Every `custom` problem in `sectionValidity`
 * blocks, so an advisory must never be handed to it.
 */
export type LineProblem = { line: number; message: string; advisory?: boolean };

/** The problems that stop a save — what the screen's gate and the action read. */
export const blockingProblems = (ps: readonly LineProblem[]): LineProblem[] =>
  ps.filter((p) => !p.advisory);

const blank = (n: number | null) => n == null;
const isWhole = (n: number | null): n is number => n != null && Number.isInteger(n);

export const isBlankLine = (l: PackingLineDraft): boolean =>
  !l.style_ref_no &&
  !l.combo &&
  blank(l.from_carton_no) &&
  blank(l.to_carton_no) &&
  !l.assortment_type &&
  blank(l.pcs_per_carton) &&
  blank(l.length_cm) &&
  blank(l.width_cm) &&
  blank(l.height_cm) &&
  blank(l.gross_weight) &&
  blank(l.net_weight);

/** The spec's Total Cartons: (To − From) + 1. Null until both ends make sense. */
export function totalCartons(from: number | null, to: number | null): number | null {
  if (!isWhole(from) || !isWhole(to) || from < 1 || to < from) return null;
  return to - from + 1;
}

/** The spec's Line Total Pcs: Total Cartons × Pcs / Ctn. */
export function lineTotalPcs(l: Pick<PackingLineDraft, "from_carton_no" | "to_carton_no" | "pcs_per_carton">): number | null {
  const ctns = totalCartons(l.from_carton_no, l.to_carton_no);
  if (ctns == null || !isWhole(l.pcs_per_carton) || l.pcs_per_carton <= 0) return null;
  return ctns * l.pcs_per_carton;
}

/** The header's Total Cartons / Total Packed Pcs — sums over the lines, never stored. */
export function adviceTotals(lines: readonly PackingLineDraft[]): { cartons: number; pcs: number } {
  let cartons = 0;
  let pcs = 0;
  for (const l of lines) {
    cartons += totalCartons(l.from_carton_no, l.to_carton_no) ?? 0;
    pcs += lineTotalPcs(l) ?? 0;
  }
  return { cartons, pcs };
}

/**
 * What the ORDER offers — destinations, and each style's colours. The action
 * builds it from the database, the screen from the same loader's rows, so both
 * refuse a style the order does not carry for the chosen destination.
 */
export type OrderPackingFacts = {
  /** style key → the combos (colours) the order declares for it. */
  combosByStyle: ReadonlyMap<string, readonly string[]>;
  /** Style keys that ship to the chosen destination. */
  stylesForDestination: ReadonlySet<string>;
};

/** The order's facts for one destination. `null` destination = none chosen yet. */
export function orderFactsFor(
  order: {
    destinations: readonly { country_id: string; styles: readonly string[] }[];
    styles: readonly { style_ref_no: string; combos: readonly string[] }[];
  },
  countryId: string | null,
): OrderPackingFacts {
  return {
    combosByStyle: new Map(order.styles.map((s) => [styleKey(s.style_ref_no), s.combos])),
    stylesForDestination: new Set(
      order.destinations.find((d) => d.country_id === countryId)?.styles ?? [],
    ),
  };
}

/** Everything wrong with one line on its own. The line is known not to be blank. */
function oneLineProblems(l: PackingLineDraft, line: number, facts: OrderPackingFacts | null): string[] {
  const out: string[] = [];
  const style = styleKey(l.style_ref_no);

  if (!style) out.push("choose the Style");
  else if (facts && !facts.stylesForDestination.has(style))
    out.push(`style ${l.style_ref_no} does not ship to this destination on the order`);

  if (!l.combo) out.push("choose the Colour");
  else if (facts && style && !(facts.combosByStyle.get(style) ?? []).some((c) => styleKey(c) === styleKey(l.combo)))
    out.push(`colour ${l.combo} is not a colour of style ${l.style_ref_no} on the order`);

  if (blank(l.from_carton_no)) out.push("enter Ctn From");
  else if (!isWhole(l.from_carton_no) || l.from_carton_no < 1) out.push("Ctn From must be a whole number from 1");

  if (blank(l.to_carton_no)) out.push("enter Ctn To");
  else if (!isWhole(l.to_carton_no) || l.to_carton_no < 1) out.push("Ctn To must be a whole number from 1");
  else if (isWhole(l.from_carton_no) && l.to_carton_no < l.from_carton_no)
    out.push(`Ctn To (${l.to_carton_no}) is before Ctn From (${l.from_carton_no})`);

  if (!l.assortment_type) out.push("choose the Assortment Type");

  if (blank(l.pcs_per_carton)) out.push("enter Pcs / Ctn");
  else if (!isWhole(l.pcs_per_carton) || l.pcs_per_carton <= 0) out.push("Pcs / Ctn must be a whole number above 0");

  for (const [v, name] of [
    [l.length_cm, "Length"],
    [l.width_cm, "Width"],
    [l.height_cm, "Height"],
    [l.gross_weight, "Gross Wt"],
    [l.net_weight, "Net Wt"],
  ] as const) {
    if (v != null && !(Number.isFinite(v) && v > 0)) out.push(`${name} must be a number above 0`);
  }
  if (l.gross_weight != null && l.net_weight != null && l.net_weight > l.gross_weight)
    out.push(`Net Wt (${l.net_weight}) is more than Gross Wt (${l.gross_weight})`);

  return out.map((m) => `Line ${line}: ${m}.`);
}

/**
 * Carton ranges across the whole advice.
 *
 * A carton number is ONE physical box, so two lines may never claim the same
 * one — 0579's `pal_no_carton_overlap` refuses it in the database, and this is
 * what names the clash on screen before the operator ever reaches Save.
 *
 * Receives only lines whose From/To are both valid whole numbers with
 * From <= To (`line` is the operator's 1-based line number).
 *
 * A GAP IS ADVISORY (user, 2026-09-18): a skipped number is usually a typo (12
 * typed for 11), but a carton is sometimes withheld on purpose — pulled for
 * buyer inspection, a sample approval, a split shipment. So it is said while
 * typing and never blocks a legitimate split dispatch.
 *
 * COMPARED AGAINST THE FURTHEST CARTON REACHED, not the previous range. With
 * 1–100, 10–20, 30–40, the previous range for 30–40 is 10–20: comparing to it
 * reports a false gap at 21–29 (line 1 covers it) and misses that 30–40 sits
 * inside line 1.
 */
export interface CartonRange {
  line: number;
  from: number;
  to: number;
}

export function cartonRangeProblems(ranges: readonly CartonRange[]): LineProblem[] {
  const problems: LineProblem[] = [];
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  let reach: CartonRange | null = null; // the range ending furthest so far

  for (const curr of sorted) {
    if (reach && curr.from <= reach.to) {
      problems.push({
        line: curr.line,
        message: `Line ${curr.line}: cartons ${curr.from}–${curr.to} overlap Line ${reach.line} (${reach.from}–${reach.to}).`,
      });
    } else if (reach && curr.from > reach.to + 1) {
      const gap =
        curr.from - 1 === reach.to + 1 ? `carton ${reach.to + 1}` : `cartons ${reach.to + 1}–${curr.from - 1}`;
      problems.push({
        line: curr.line,
        message: `${gap[0].toUpperCase()}${gap.slice(1)} skipped between Line ${reach.line} and Line ${curr.line}.`,
        advisory: true,
      });
    }
    if (!reach || curr.to > reach.to) reach = curr;
  }
  return problems;
}

/** Every problem on the advice's lines, in line order, then the cross-line ones. */
export function lineProblems(
  lines: readonly PackingLineDraft[],
  facts: OrderPackingFacts | null,
): LineProblem[] {
  const out: LineProblem[] = [];
  const ranges: { line: number; from: number; to: number }[] = [];
  let kept = 0;

  lines.forEach((l, i) => {
    if (isBlankLine(l)) return;
    kept++;
    const line = i + 1;
    for (const message of oneLineProblems(l, line, facts)) out.push({ line, message });
    if (totalCartons(l.from_carton_no, l.to_carton_no) != null)
      ranges.push({ line, from: l.from_carton_no!, to: l.to_carton_no! });
  });

  if (kept === 0) out.push({ line: 1, message: "Add at least one carton line." });
  return [...out, ...cartonRangeProblems(ranges)];
}

export const assortmentLabel = (t: AssortmentType | null | undefined) =>
  t ? ASSORTMENT_TYPE_LABELS[t] : "";
