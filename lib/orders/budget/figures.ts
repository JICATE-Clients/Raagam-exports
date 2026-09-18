/**
 * A budget's figures from its lines and its orders' facts — the ONE place the
 * inputs to the engine are assembled.
 *
 * The screen shows these figures as the operator types; `submitBudget` stores
 * the KPIs the approver approves against (`submitted_summary`); the Amendment
 * Protocol freezes them as the approved baseline. If those three assembled the
 * engine's inputs three ways, the summary an MD approved could differ from the
 * screen the merchandiser saw — the same budget, two profits. So they call
 * this.
 *
 * Client-safe (no `server-only`), for that reason: the screen imports it too.
 * It computes nothing itself — `budgetTotals`, `salesSummary`,
 * `generalSummary` and `budgetKpis` do — it only shapes their inputs.
 */

import {
  budgetTotals,
  generalSummary,
  salesSummary,
  type BudgetLineInput,
  type BudgetOrderInput,
  type BudgetTotals,
  type GeneralSummary,
  type Refusal,
  type SalesOrderFacts,
  type SalesSummary,
} from "./totals";
import { budgetKpis, type BudgetKpis, type KpiOrder } from "./amendment";
import type { BudgetableOrder, BudgetOrder } from "./types";

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A stored or typed line, as much of it as the engine reads. Numbers may
 *  arrive as strings (a form's state, a numeric column) — read, never trusted. */
export type LineLike = {
  source: string | null;
  qty: number | string | null;
  rate: number | string | null;
  currency_code?: string | null;
  ex_rate?: number | string | null;
  is_foc?: boolean | null;
  rate_type?: string | null;
  no_of_pcs?: number | string | null;
  no_of_units?: number | string | null;
  garment_order_id?: string | null;
  style_ref_no?: string | null;
  description?: string | null;
};

/** One line as the engine reads it. */
export function lineInputOf(l: LineLike): BudgetLineInput {
  const rt = l.rate_type === "flat" || l.rate_type === "percent" ? l.rate_type : "per_unit";
  return {
    source: l.source,
    qty: numOrNull(l.qty),
    rate: numOrNull(l.rate),
    currency_code: l.currency_code || null,
    ex_rate: numOrNull(l.ex_rate),
    is_foc: l.is_foc === true,
    rate_type: rt,
    no_of_pcs: numOrNull(l.no_of_pcs),
    no_of_units: numOrNull(l.no_of_units),
    garment_order_id: l.garment_order_id ?? null,
    style_ref_no: l.style_ref_no ?? null,
    description: l.description || null,
  };
}

/** What names an order in a refusal. */
const labelOf = (o: BudgetableOrder) => o.sc_no ?? o.order_code ?? "This order";

/** The orders as the engine values them, from their LIVE facts — the budget
 *  screen's source and submit's. The SAME list feeds the totals and every
 *  percent line's base. */
export function orderInputsOf(facts: readonly BudgetableOrder[]): BudgetOrderInput[] {
  return facts.map((o) => ({
    id: o.id,
    label: labelOf(o),
    sales_value: o.sales_value,
    refusal: o.sales_refusal,
  }));
}

/**
 * The orders as the engine values them, from the budget's STORED SNAPSHOT
 * (`order_budget_orders.sales_value` / `sales_refusal`) — the approval
 * screen's source. The approver must see the figures that were submitted, not
 * a live re-read (0428).
 *
 * The two agree by construction at submit: `submitBudget` computes the summary
 * from the live facts through `orderInputsOf` AND rewrites the snapshot from
 * those same facts in the same action, so the approver's totals and the stored
 * summary are one set of numbers.
 */
export function orderInputsOfSnapshot(orders: readonly BudgetOrder[]): BudgetOrderInput[] {
  return orders.map((o) => ({
    id: o.garment_order_id,
    label: o.garment_order?.sales_order?.order_number ?? o.garment_order?.code ?? "This order",
    sales_value: o.sales_value,
    refusal: o.sales_refusal,
  }));
}

/** The bottom bar's order facts, in the buyer's terms. */
export function salesFactsOf(facts: readonly BudgetableOrder[]): SalesOrderFacts[] {
  return facts.map((o) => ({
    label: labelOf(o),
    qty: o.qty,
    unit: o.unit,
    currency_code: o.currency_code,
    ex_rate: o.ex_rate,
    gross_value: o.gross_value,
  }));
}

/** Σ the orders' SQ Qty, or the first refusal — never a part-sum. */
export function groupSqQtyOf(facts: readonly BudgetableOrder[]): number | Refusal {
  const bad = facts.find((o) => o.sq_qty == null);
  if (bad) {
    return { refused: bad.sq_refusal ?? `${labelOf(bad)} has no SQ Qty yet` };
  }
  return facts.reduce((a, o) => a + (o.sq_qty as number), 0);
}

export type BudgetFigures = {
  totals: BudgetTotals;
  sales: SalesSummary;
  general: GeneralSummary;
  kpis: BudgetKpis;
};

/**
 * Every figure the budget reports, from its lines and its orders.
 *
 * `facts` are the budget's orders in its own order (`order_budget_orders.sno`)
 * — `re_nos` in the summary follow it.
 */
export function budgetFigures(v: {
  lines: readonly LineLike[];
  facts: readonly BudgetableOrder[];
  entryDate: string | null;
}): BudgetFigures {
  const totals = budgetTotals(v.lines.map(lineInputOf), orderInputsOf(v.facts));
  const sales = salesSummary(salesFactsOf(v.facts));
  const general = generalSummary(totals, groupSqQtyOf(v.facts));
  const kpiOrders: KpiOrder[] = v.facts.map((o) => ({ re_no: o.re_no, delivery_date: o.delivery_date }));
  const kpis = budgetKpis({ entryDate: v.entryDate, orders: kpiOrders, sales, totals, general });
  return { totals, sales, general, kpis };
}
