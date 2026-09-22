/**
 * IWO Budget — the line rules, ONCE (Phase 4). Pure: the screen's Save gate
 * and the action read the same functions, so a Save button can never allow
 * what the server then refuses.
 *
 * THE VALUE OF A LINE IS THE ORDER BUDGET'S. `lineProblem` / `lineAmount`
 * (`lib/orders/budget/totals.ts`) decide whether a line can be priced and
 * what it costs; this file adds only what is the IWO's own: which sources a
 * work order of this For may carry, and what an Other Expenses line owes.
 */

import { lineProblem, type LineField } from "@/lib/orders/budget/totals";
import { lineInputOf } from "@/lib/orders/budget/figures";
import type { IwoFor } from "@/lib/orders/internal-work-orders/types";
import { IWO_BUDGET_GRIDS, IWO_BUDGET_SOURCE_LABELS } from "./types";
import type { IwoBudgetSource } from "./pull";

/** A line as the rules read it — numbers may be NaN (typed non-numbers). */
export type IwoBudgetLineFacts = {
  source: IwoBudgetSource;
  item_id: string | null;
  process_id: string | null;
  cost_head_id: string | null;
  description?: string | null;
  qty: number | null;
  rate: number | null;
  rate_type: "per_unit" | "flat";
  currency_code: string | null;
  ex_rate: number | null;
  is_foc: boolean;
  from_bom: boolean;
};

/**
 * THE BLANK-ROW FILTER TESTS ONLY WHAT THE OPERATOR TYPES (AGENTS.md, default
 * rows). Every grid opens with a seeded row whose Qty reads 1 — the order
 * Budget's visible default for a typed line — so `qty` is deliberately NOT in
 * this test, or every untouched seed would save as a phantom line. A pulled
 * line is never blank.
 */
export const isBlankIwoBudgetLine = (l: IwoBudgetLineFacts): boolean =>
  !l.from_bom &&
  !l.item_id &&
  !l.process_id &&
  !l.cost_head_id &&
  !(l.description ?? "").trim() &&
  l.rate == null &&
  !l.currency_code;

export function keptIwoBudgetLines<T extends IwoBudgetLineFacts>(lines: readonly T[]): T[] {
  return lines.filter((l) => !isBlankIwoBudgetLine(l));
}

/** Which sources a work order of this For carries — plus Other Expenses. */
export function sourcesFor(iwoFor: IwoFor): IwoBudgetSource[] {
  const g = IWO_BUDGET_GRIDS[iwoFor];
  return [...g.purchase, ...g.process, "expense"];
}

export type IwoBudgetProblem = {
  /** Index in the list AS SENT, blank rows included. */
  index: number;
  source: IwoBudgetSource;
  field: LineField | "item_id" | "process_id" | "cost_head_id";
  message: string;
};

/**
 * Everything stopping a save, in list order.
 *
 *   - A source this work order does not carry (a yarn line on an Accessories
 *     IWO) — a stale screen or a forged payload.
 *   - WHAT THE LINE IS FOR: an item on a purchase, a process on a process
 *     line, a head or a description on an Other Expense. A priced line naming
 *     nothing is a cost nobody can check.
 *   - THE ORDER BUDGET'S OWN PRICING RULES (`lineProblem`): a rate on a paid
 *     line, a quantity on a per-unit line, an exchange rate with a currency.
 *     No sales base is passed — an IWO has no percent lines (0594).
 */
export function iwoBudgetProblems(lines: readonly IwoBudgetLineFacts[], iwoFor: IwoFor): IwoBudgetProblem[] {
  const allowed = new Set(sourcesFor(iwoFor));
  const out: IwoBudgetProblem[] = [];
  lines.forEach((l, index) => {
    if (isBlankIwoBudgetLine(l)) return;
    const where = IWO_BUDGET_SOURCE_LABELS[l.source] ?? l.source;
    const at = (field: IwoBudgetProblem["field"], message: string) =>
      out.push({ index, source: l.source, field, message: `${where}: ${message}` });

    if (!allowed.has(l.source)) {
      at("item_id", "this work order does not carry this kind of line.");
      return;
    }
    if (l.source === "expense") {
      if (!l.cost_head_id && !(l.description ?? "").trim()) at("cost_head_id", "choose the Head or type what the expense is.");
    } else if (l.source.endsWith("_process")) {
      if (!l.process_id) at("process_id", "choose the Process.");
    } else if (!l.item_id) {
      at("item_id", "choose the item.");
    }
    const p = lineProblem(lineInputOf(l));
    if (p) at(p.field, p.message);
  });
  return out;
}
