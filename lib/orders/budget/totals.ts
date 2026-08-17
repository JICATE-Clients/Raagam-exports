/**
 * Order Budget — what the grouped orders are worth, what they cost, and the
 * difference.
 *
 * Step 7 of the client's order flow. `doc/prd.md`, in the client's own words:
 *
 *   "After BOM, budgeting is done using Fabric BOM and Material BOM of various
 *    orders which are grouped together. This budget is approved. After approval
 *    it should downstream to purchase module."
 *
 * Three things follow from that sentence and all three shape this module: a
 * budget covers MANY orders, its cost lines come from the two BOMs, and the
 * number that matters is the comparison between those costs and what the orders
 * will sell for.
 *
 * ## A PARTIAL SUM IS THE FAILURE THIS MODULE EXISTS TO PREVENT
 *
 * `order-value.ts` records the rule for one order and it is sharper across a
 * group: if one of five orders cannot be valued, adding the other four gives a
 * smaller sales figure, a healthier-looking cost ratio, and a profit percentage
 * that is simply wrong. Nothing on screen would say four-fifths of an answer had
 * been shown. So an unresolved order poisons the WHOLE profit figure, and the
 * budget names which order it was.
 *
 * Costs are different and deliberately so: a cost line either has a number or is
 * not a line yet. There is no "unresolvable" cost, so the cost total is always
 * answerable and is shown even while the sales side refuses — which is what lets
 * an operator build a budget before every price is confirmed.
 *
 * ## INCOME ADDS. IT IS NOT A NEGATIVE COST.
 *
 * The legacy budget has Other Expenses and Other Incomes as separate tabs, and
 * they are separate here for a reason beyond tidiness: folding income into cost
 * as a negative makes the COST TOTAL wrong — which is the figure a purchase
 * ceiling is checked against, and the one number in this document that is not
 * merely informational.
 *
 * Client-safe (no `server-only`) for the reason every other engine here is: the
 * figures recalculate as the operator types, and the server stores what these
 * same functions produce.
 */

import { money } from "@/lib/finance/calc";

// `money` is imported rather than redefined. There are already three copies of
// two-decimal rounding in this repo (finance, hr, and a private one inside
// order-value.ts), and they do not all agree — the finance one adds
// `Number.EPSILON` before rounding and the others do not. A fourth copy would be
// a fourth answer to "what is 0.145 to two places" on a screen whose whole job
// is money.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Where a budget line's figure comes from.
 *
 * `fabric` and `material` are PULLED from the two BOMs; `process`, `cmt`,
 * `expense` and `income` are typed. The distinction is not cosmetic — a pulled
 * line's quantity is a stored requirement somebody else computed, so re-typing it
 * here would be a second answer to a question already answered.
 */
export const BUDGET_SOURCES = [
  "fabric",
  "material",
  "process",
  "cmt",
  "expense",
  "income",
] as const;
export type BudgetSource = (typeof BUDGET_SOURCES)[number];

export const BUDGET_SOURCE_LABELS: Record<BudgetSource, string> = {
  fabric: "Fabric",
  material: "Material",
  process: "Processing",
  cmt: "CMT",
  expense: "Other expense",
  income: "Other income",
};

/** The sources that are PULLED from a BOM rather than typed. */
export const PULLED_SOURCES: ReadonlySet<BudgetSource> = new Set<BudgetSource>([
  "fabric",
  "material",
]);

/** What the screen prints when a figure cannot be produced. Never an empty
 *  string: a blank cell and a refused cell must not look alike. */
export type Refusal = { refused: string };

export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && typeof (v as Refusal).refused === "string";
}

export function budgetSourceOf(v: string | null | undefined): BudgetSource | Refusal {
  const k = (v ?? "").trim().toLowerCase();
  return (BUDGET_SOURCES as readonly string[]).includes(k)
    ? (k as BudgetSource)
    : { refused: "Choose what this line is for" };
}

// ---------------------------------------------------------------------------
// A line
// ---------------------------------------------------------------------------

export type BudgetLineInput = {
  source: string | null;
  qty: number | null;
  rate: number | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * One line's amount — `qty x rate`, to two places.
 *
 * ## AMOUNT IS DERIVED AND HAS NO COLUMN
 *
 * The alternative is a typed Amount beside a typed Qty and Rate, which is three
 * numbers stating two facts. They disagree the first time someone edits the rate
 * and not the amount, and the document then holds a total nobody can reproduce
 * from its own lines. A lump sum is entered as qty 1 — visibly, in the box, not
 * as a silent default.
 *
 * A NEGATIVE RATE IS REFUSED, on every source including income. "Income" is
 * already the sign; a negative income is a cost wearing the wrong label, and it
 * would subtract from the wrong total.
 */
export function lineAmount(line: BudgetLineInput): number | Refusal {
  const qty = num(line.qty);
  const rate = num(line.rate);

  // 0 IS NOT AN ANSWER HERE EITHER, but only for qty — a rate of 0 is a real
  // thing to budget (a free-issue trim, a process the customer pays for) and
  // refusing it would make those unenterable.
  if (qty == null || qty <= 0) return { refused: "Enter a quantity — use 1 for a lump sum" };
  if (rate == null) return { refused: "Enter a rate" };
  if (rate < 0) return { refused: "A rate cannot be negative — use Other income instead" };

  return money(qty * rate);
}

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/** One order in the group, with what it will sell for. */
export type BudgetOrderInput = {
  /** For naming the order in a refusal. */
  label: string;
  /** Null when the order cannot be valued — see `refusal`. */
  sales_value: number | null;
  /** Why it cannot, when it cannot. */
  refusal: string | null;
};

export type BudgetTotals = {
  /** Every cost line added up. Always answerable. */
  cost: number;
  /** Cost broken out by source, for the summary strip. */
  costBySource: Record<BudgetSource, number>;
  /** Other income. Kept apart from cost — see the header. */
  income: number;
  /** What the grouped orders will sell for. Refuses rather than part-summing. */
  sales: number | Refusal;
  /** sales + income − cost. Refuses whenever `sales` does. */
  profit: number | Refusal;
  /** profit as a percentage of sales. Refuses when sales does, or is zero. */
  profitPct: number | Refusal;
  /** Lines that could not produce an amount, with the reason. Never silently
   *  dropped from the total: they are EXCLUDED and counted here, so a budget
   *  cannot look complete while a line is unanswered. */
  unpriced: { index: number; reason: string }[];
};

/**
 * Add a budget up.
 *
 * ## AN UNPRICED LINE IS EXCLUDED AND REPORTED, NOT TREATED AS ZERO
 *
 * A half-typed line contributes nothing to the cost — there is no honest number
 * to add — but a cost total that quietly ignored it would be the "0 is not an
 * answer" failure at document level: smaller, plausible, and believed. The
 * screen shows the count and the Save gate reads it.
 *
 * ## `sales` REFUSES ON THE FIRST UNRESOLVED ORDER
 *
 * Not on all of them, and not by summing what it can. See the header: four
 * fifths of a sales figure produces a profit percentage that is wrong in the
 * flattering direction.
 */
export function budgetTotals(
  lines: readonly BudgetLineInput[],
  orders: readonly BudgetOrderInput[],
): BudgetTotals {
  const costBySource: Record<BudgetSource, number> = {
    fabric: 0,
    material: 0,
    process: 0,
    cmt: 0,
    expense: 0,
    income: 0,
  };
  const unpriced: { index: number; reason: string }[] = [];
  let cost = 0;
  let income = 0;

  lines.forEach((l, i) => {
    const source = budgetSourceOf(l.source);
    if (isRefusal(source)) {
      unpriced.push({ index: i, reason: source.refused });
      return;
    }
    const amount = lineAmount(l);
    if (isRefusal(amount)) {
      unpriced.push({ index: i, reason: amount.refused });
      return;
    }
    costBySource[source] = money(costBySource[source] + amount);
    if (source === "income") income = money(income + amount);
    else cost = money(cost + amount);
  });

  let sales: number | Refusal;
  if (orders.length === 0) {
    sales = { refused: "No orders in this budget yet" };
  } else {
    const bad = orders.find((o) => o.sales_value == null);
    sales = bad
      ? {
          refused: bad.refusal
            ? `${bad.label}: ${bad.refusal}`
            : `${bad.label} has no order value yet`,
        }
      : money(orders.reduce((a, o) => a + (num(o.sales_value) ?? 0), 0));
  }

  const profit: number | Refusal = isRefusal(sales) ? sales : money(sales + income - cost);

  const profitPct: number | Refusal = isRefusal(sales)
    ? sales
    : sales <= 0
      ? // A PERCENTAGE OF NOTHING IS NOT 0% — it is undefined, and printing 0%
        // beside a real profit figure is the most confidently wrong thing this
        // document could say.
        { refused: "No sales value to measure the margin against" }
      : Math.round(((profit as number) / sales) * 10000) / 100;

  return { cost, costBySource, income, sales, profit, profitPct, unpriced };
}
