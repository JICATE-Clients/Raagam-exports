/**
 * Vectors for `lib/orders/budget/totals.ts` — what a group of orders costs,
 * what it will sell for, and the margin between them.
 *
 * THIS IS THE DOCUMENT THAT GETS APPROVED, and the approval is a commercial
 * decision. Its failure mode is not a wrong pixel: a margin that reads healthy
 * because one order's price could not be resolved is an order taken at a loss,
 * discovered at invoicing.
 *
 * ## THE ONE THAT MATTERS: A PARTIAL SALES SUM IS FLATTERING
 *
 * Drop an unvaluable order and the sales figure falls, the cost stays, and the
 * margin gets WORSE — so the naive failure is at least visible. The dangerous
 * one is the other way round: drop the order's COST too (by excluding it from
 * the group) and the ratio looks fine. Section 3 pins both directions, and
 * asserts that sales refuses rather than summing what it can.
 *
 * ## THE SECOND ONE: INCOME IS NOT A NEGATIVE COST
 *
 * Folding Other Income into cost as a negative gives the same PROFIT and a
 * different COST — and cost is the figure a purchase ceiling is checked against.
 * Section 2 makes the two disagree.
 *
 * Runs under `tsx` for `check-bom-requirement.mts`'s reason: the module imports
 * a `@/lib/...` alias at runtime and Node's ESM resolver does not read it.
 */
import {
  BUDGET_SOURCES,
  budgetSourceOf,
  budgetTotals,
  isRefusal,
  lineAmount,
  orderSalesValue,
  type BudgetLineInput,
  type BudgetOrderInput,
} from "../lib/orders/budget/totals.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

function refute(label: string, actual: unknown, forbidden: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function refusalOf(v: unknown): string | null {
  return isRefusal(v) ? v.refused : null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const line = (source: string, qty: number, rate: number): BudgetLineInput => ({
  source,
  qty,
  rate,
});
const order = (label: string, sales: number | null, refusal: string | null = null): BudgetOrderInput => ({
  label,
  sales_value: sales,
  refusal,
});

/** Two orders selling 500,000; fabric 200,000 + material 50,000 of cost. */
const LINES = [line("fabric", 1000, 200), line("material", 5000, 10)];
const ORDERS = [order("SC-1", 300_000), order("SC-2", 200_000)];

// ---------------------------------------------------------------------------
// 1. The arithmetic
// ---------------------------------------------------------------------------

check("cost is every non-income line", budgetTotals(LINES, ORDERS).cost, 250_000);
check("sales is the group's orders added up", budgetTotals(LINES, ORDERS).sales, 500_000);
check("profit is sales + income − cost", budgetTotals(LINES, ORDERS).profit, 250_000);
check("margin is profit over sales", budgetTotals(LINES, ORDERS).profitPct, 50);

check("a line's amount is qty x rate", lineAmount(line("fabric", 1000, 200)), 200_000);
check(
  "cost is broken out by source",
  budgetTotals(LINES, ORDERS).costBySource,
  { fabric: 200_000, material: 50_000, process: 0, cmt: 0, expense: 0, income: 0 },
);

// ---------------------------------------------------------------------------
// 2. INCOME ADDS TO PROFIT AND NEVER SUBTRACTS FROM COST
//
// Both treatments give the same profit. Only one gives the right COST — and cost
// is what a purchase ceiling is checked against, so it is the figure that is
// spent rather than merely reported.
// ---------------------------------------------------------------------------

const WITH_INCOME = [...LINES, line("income", 1, 20_000)];

check("income leaves the cost total alone", budgetTotals(WITH_INCOME, ORDERS).cost, 250_000);
refute(
  "…it is NOT folded in as a negative cost, which would give 230,000",
  budgetTotals(WITH_INCOME, ORDERS).cost,
  230_000,
);
check("income is reported on its own", budgetTotals(WITH_INCOME, ORDERS).income, 20_000);
check("and it does raise the profit", budgetTotals(WITH_INCOME, ORDERS).profit, 270_000);

// A NEGATIVE RATE IS REFUSED, so "income as a negative expense" cannot be typed
// in either — the two halves of the same rule.
check(
  "a negative rate refuses and names the right control",
  refusalOf(lineAmount(line("expense", 1, -5000))),
  "A rate cannot be negative — use Other income instead",
);

// ---------------------------------------------------------------------------
// 3. AN UNVALUABLE ORDER POISONS THE WHOLE SALES FIGURE
// ---------------------------------------------------------------------------

const ONE_BAD = [order("SC-1", 300_000), order("SC-2", null, "two prices for one style")];

check(
  "sales refuses and names the order AND the reason",
  refusalOf(budgetTotals(LINES, ONE_BAD).sales),
  "SC-2: two prices for one style",
);
refute(
  "…rather than summing the orders it could value",
  budgetTotals(LINES, ONE_BAD).sales,
  300_000,
);
check("profit refuses with it", refusalOf(budgetTotals(LINES, ONE_BAD).profit), "SC-2: two prices for one style");
check(
  "and so does the margin",
  refusalOf(budgetTotals(LINES, ONE_BAD).profitPct),
  "SC-2: two prices for one style",
);
// THE COST SIDE KEEPS WORKING. That is what lets a budget be built before every
// price is confirmed, and it is why cost and sales are not one refusal.
check("the cost total still answers", budgetTotals(LINES, ONE_BAD).cost, 250_000);

check(
  "an order with no reason still refuses, with a usable sentence",
  refusalOf(budgetTotals(LINES, [order("SC-9", null)]).sales),
  "SC-9 has no order value yet",
);
check(
  "a budget with no orders refuses rather than reporting 0 sales",
  refusalOf(budgetTotals(LINES, []).sales),
  "No orders in this budget yet",
);
refute("…and never says the group sells for nothing", budgetTotals(LINES, []).sales, 0);

// ---------------------------------------------------------------------------
// 4. A PERCENTAGE OF NOTHING IS NOT 0%
// ---------------------------------------------------------------------------

check(
  "zero sales refuses the margin",
  refusalOf(budgetTotals(LINES, [order("SC-1", 0)]).profitPct),
  "No sales value to measure the margin against",
);
refute(
  "…and never prints 0% beside a real loss",
  budgetTotals(LINES, [order("SC-1", 0)]).profitPct,
  0,
);
// The profit itself is still a number — a loss of 250,000 is a fact worth
// showing even when there is nothing to express it as a percentage of.
check("but the profit figure survives", budgetTotals(LINES, [order("SC-1", 0)]).profit, -250_000);

// ---------------------------------------------------------------------------
// 5. AN UNPRICED LINE IS EXCLUDED AND COUNTED, NEVER TREATED AS ZERO
// ---------------------------------------------------------------------------

const HALF_TYPED = [...LINES, { source: "cmt", qty: 500, rate: null }];

check("a rate-less line is reported", budgetTotals(HALF_TYPED, ORDERS).unpriced, [
  { index: 2, reason: "Enter a rate" },
]);
check("…and contributes nothing to the cost", budgetTotals(HALF_TYPED, ORDERS).cost, 250_000);
check(
  "a line with no source is reported too",
  budgetTotals([{ source: null, qty: 1, rate: 5 }], ORDERS).unpriced,
  [{ index: 0, reason: "Choose what this line is for" }],
);

check(
  "a blank quantity refuses, and the message says what a lump sum looks like",
  refusalOf(lineAmount({ source: "expense", qty: null, rate: 5000 })),
  "Enter a quantity — use 1 for a lump sum",
);
// A RATE OF 0 IS LEGITIMATE and must not be refused: a free-issue trim and a
// process the customer pays for are both real budget lines.
check("a rate of 0 is a real line", lineAmount(line("material", 100, 0)), 0);

// ---------------------------------------------------------------------------
// 6. Money is rounded to two places, once
// ---------------------------------------------------------------------------

check("0.1 x 3 does not leak a float artefact", lineAmount(line("expense", 3, 0.1)), 0.3);
check(
  "a running total rounds at each addition, not once at the end",
  budgetTotals([line("expense", 3, 0.1), line("expense", 3, 0.1)], ORDERS).cost,
  0.6,
);

// ---------------------------------------------------------------------------
// 7. The vocabulary
// ---------------------------------------------------------------------------

check("the six sources", [...BUDGET_SOURCES], [
  "fabric",
  "material",
  "process",
  "cmt",
  "expense",
  "income",
]);
check("case is not the operator's problem", budgetSourceOf("Fabric"), "fabric");
check(
  "an unknown source refuses rather than defaulting",
  refusalOf(budgetSourceOf("overheads")),
  "Choose what this line is for",
);

// ---------------------------------------------------------------------------
// Currency: an order's value reaches a budget in INR, or not at all
//
// `orderValue` answers in the BUYER'S own currency. Until 2026-08-21 that figure
// was handed straight to the budget as `sales_value`, so a budget grouping a USD
// order with an INR one ADDED THE TWO TOGETHER UNCONVERTED - an ordinary-looking
// total that is the sum of two different units, and the number a profit margin
// is calculated from.
//
// These vectors are on `orderSalesValue` rather than on the service that calls
// it, because that service is `server-only` and a vector cannot reach it.
// ---------------------------------------------------------------------------

const usd = { grossValue: 1000, unresolved: [] as string[], exRate: 88, currencyCode: "USD" };

check("a USD order converts at its rate", orderSalesValue(usd).value, 88000);
refute("...not the raw 1,000, which is dollars in a rupee total", orderSalesValue(usd).value, 1000);

check(
  "an INR order converts at 1, whatever rate is sitting on it",
  orderSalesValue({ grossValue: 1000, unresolved: [], exRate: 88, currencyCode: "INR" }).value,
  1000,
);

/* THE SUM IS THE POINT. Two orders, two currencies: unconverted they add to
   2,000, which is the bug. Converted they add to 89,000. */
check(
  "two currencies no longer add unconverted",
  orderSalesValue(usd).value! +
    orderSalesValue({ grossValue: 1000, unresolved: [], exRate: 88, currencyCode: "INR" }).value!,
  89000,
);
refute(
  "...2,000 is what the unconverted sum used to give",
  orderSalesValue(usd).value! +
    orderSalesValue({ grossValue: 1000, unresolved: [], exRate: 88, currencyCode: "INR" }).value!,
  2000,
);

/* A 0 RATE IS "NOT ENTERED", NOT "WORTHLESS". `ex_rate` is NOT NULL DEFAULT 0,
   so the column nobody filled in reads as zero, and zero times a real gross
   value is 0.00 - an order reported as worth nothing. */
check(
  "a 0 rate refuses",
  orderSalesValue({ grossValue: 1000, unresolved: [], exRate: 0, currencyCode: "USD" }),
  { value: null, refusal: "no exchange rate on the order's Logistic tab" },
);
refute(
  "...it does not value the order at zero",
  orderSalesValue({ grossValue: 1000, unresolved: [], exRate: 0, currencyCode: "USD" }).value,
  0,
);

/* THE RATE IS THE SECOND QUESTION. An order with no price has no rate worth
   mentioning, and naming the rate sends the operator to the wrong tab. */
check(
  "an unpriced style is reported as a price problem, not a rate problem",
  orderSalesValue({ grossValue: null, unresolved: ["TSH-001"], exRate: 0, currencyCode: "USD" })
    .refusal,
  "no single price for TSH-001",
);
check(
  "no quantity at all says so",
  orderSalesValue({ grossValue: null, unresolved: [], exRate: 88, currencyCode: "USD" }).refusal,
  "no quantity on the Styles tab",
);

console.log(failed === 0 ? "\nOK — every budget total vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
