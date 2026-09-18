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
  BUDGET_SECTIONS,
  BUDGET_SOURCES,
  CMT_OPERATIONS,
  GENERAL_CATEGORIES,
  PROCESS_TABS,
  PULLED_SOURCES,
  PURCHASE_TABS,
  budgetSourceOf,
  budgetTotals,
  carryRate,
  cmtBreakupTotal,
  generalSummary,
  isRefusal,
  lineAmount,
  lineInrRate,
  lineProblem,
  lineReqd,
  orderSalesValue,
  pulledLineKey,
  round4,
  salesBaseOf,
  salesSummary,
  splitFabricProcess,
  type BudgetLineInput,
  type BudgetOrderInput,
  type FabricProcessRow,
  type Refusal,
  type SalesOrderFacts,
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
  /* `yarn: 0` IS PART OF THE ASSERTION, not padding. Every source appears with a
     zero even when nothing uses it, so the breakdown has a fixed shape a screen
     can render without asking which keys exist — and so a source ADDED without
     being initialised (0493 nearly did exactly that) fails here rather than
     reaching a total as `undefined`. */
  {
    fabric: 200_000,
    yarn: 0,
    yarn_process: 0,
    fabric_process: 0,
    material: 50_000,
    material_process: 0,
    garment_process: 0,
    cmt: 0,
    expense: 0,
    income: 0,
  },
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

check("a rate-less line is reported, with the field it is in", budgetTotals(HALF_TYPED, ORDERS).unpriced, [
  { index: 2, reason: "Enter a rate", field: "rate" },
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

/* TEN SINCE 0573, and the ORDER is asserted as well as the membership: a flat
   list or an export walks this array, so each `*_process` sits directly after
   the thing it processes. `process` (typed) is GONE — 0573 rewrote it as
   `garment_process` — and the refusal below is what an old caller now gets. */
check("the ten sources", [...BUDGET_SOURCES], [
  "fabric",
  "yarn",
  "yarn_process",
  "fabric_process",
  "material",
  "material_process",
  "garment_process",
  "cmt",
  "expense",
  "income",
]);
check(
  "the retired `process` source refuses rather than landing in a bucket",
  refusalOf(budgetSourceOf("process")),
  "Choose what this line is for",
);
check(
  "every process source and CMT are PULLED; only expense / income are typed",
  BUDGET_SOURCES.filter((s) => !PULLED_SOURCES.has(s)),
  ["expense", "income"],
);
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

// ---------------------------------------------------------------------------
// 8. A LINE'S RATE IS IN THE LINE'S CURRENCY (0572)
//
// Until 0572 every `rate` was rupees. It is now stated in `currency_code`, and a
// USD rate that reaches the total unconverted is the 2026-08-21 sales bug again,
// on the cost side: a yarn bought at $3.00 costed at Rs 3.00.
// ---------------------------------------------------------------------------

const fx = (
  qty: number | null,
  rate: number | null,
  currency_code: string | null,
  ex_rate: number | null,
  is_foc = false,
): BudgetLineInput => ({ source: "yarn", qty, rate, currency_code, ex_rate, is_foc });

check("an INR line's INR rate is its rate", lineInrRate(fx(100, 250, null, null)), 250);
check("…and a line with no currency at all is INR (every pre-0572 row)", lineAmount(line("yarn", 100, 250)), 25_000);
check("an explicit INR converts at 1, whatever rate sits beside it", lineInrRate(fx(100, 250, "INR", 84)), 250);
check("a USD line's INR rate is rate x ex_rate", lineInrRate(fx(1000, 3, "USD", 84)), 252);
check("…and its amount is qty x that", lineAmount(fx(1000, 3, "USD", 84)), 252_000);
refute("…not the raw 3,000, which is dollars in a rupee total", lineAmount(fx(1000, 3, "USD", 84)), 3000);
check(
  "a USD line reaches the cost total converted",
  budgetTotals([fx(1000, 3, "USD", 84), fx(100, 250, null, null)], ORDERS).cost,
  277_000,
);

/* THE INR RATE IS NOT ROUNDED BEFORE THE MULTIPLICATION. USD 0.0137 x 84.25 is
   1.154225; rounded to 1.15 first, a 50,000-piece line comes to 57,500 instead
   of 57,711.25 — 211 rupees nobody can reproduce from the screen. */
check(
  "the INR rate keeps full precision",
  Math.round((lineInrRate(fx(50_000, 0.0137, "USD", 84.25)) as number) * 1e6) / 1e6,
  1.154225,
);
check("…and the amount is rounded once, at the end", lineAmount(fx(50_000, 0.0137, "USD", 84.25)), 57_711.25);
refute("…never from a 2dp INR rate", lineAmount(fx(50_000, 0.0137, "USD", 84.25)), 57_500);

check(
  "a foreign line with no exchange rate refuses and names the currency",
  refusalOf(lineAmount(fx(1000, 3, "USD", null))),
  "Enter the exchange rate for USD",
);
check(
  "a 0 exchange rate is 'not entered', not 'worthless'",
  refusalOf(lineAmount(fx(1000, 3, "usd", 0))),
  "Enter the exchange rate for USD",
);
refute("…it does not cost the line at zero", lineAmount(fx(1000, 3, "USD", 0)), 0);
check(
  "a line missing its exchange rate is excluded AND counted",
  budgetTotals([fx(1000, 3, "USD", null)], ORDERS).unpriced,
  [{ index: 0, reason: "Enter the exchange rate for USD", field: "ex_rate" }],
);
check(
  "the RATE is the first question — a rate-less USD line asks for the rate",
  refusalOf(lineAmount(fx(1000, null, "USD", null))),
  "Enter a rate",
);
check(
  "a negative foreign rate refuses with the same sentence as an INR one",
  refusalOf(lineInrRate(fx(1000, -3, "USD", 84))),
  "A rate cannot be negative — use Other income instead",
);

// ---------------------------------------------------------------------------
// 9. FOC IS PRICED AT NOTHING — NOT UNPRICED
//
// A trim the buyer supplies free is a finished line. Listing it as "unpriced"
// would hold Save on a budget with nothing left to type; costing it at a typed
// notional rate would put money in the cost total that is never spent.
// ---------------------------------------------------------------------------

const FOC_BLANK: BudgetLineInput = { source: "material", qty: 500, rate: null, is_foc: true };
const FOC_RATED: BudgetLineInput = { source: "material", qty: 500, rate: 12, is_foc: true };

check("a FOC line with no rate is 0", lineAmount(FOC_BLANK), 0);
check("…and is NOT in unpriced", budgetTotals([...LINES, FOC_BLANK], ORDERS).unpriced, []);
check("a FOC line with a typed rate still costs nothing", budgetTotals([...LINES, FOC_RATED], ORDERS).cost, 250_000);
refute("…the typed 6,000 does not leak into cost", budgetTotals([...LINES, FOC_RATED], ORDERS).cost, 256_000);
check("its INR rate reads 0, so Qty x INR Rate = Amount holds on the row", lineInrRate(FOC_RATED), 0);
check(
  "a FOC foreign line needs no exchange rate either",
  lineAmount({ ...FOC_BLANK, currency_code: "USD", ex_rate: null }),
  0,
);
check(
  "a FOC line still needs a quantity — it is real material",
  refusalOf(lineAmount({ ...FOC_BLANK, qty: null })),
  "Enter a quantity — use 1 for a lump sum",
);

// ---------------------------------------------------------------------------
// 10. EVERY SOURCE IS IN EXACTLY ONE SECTION
//
// A source in no section is a line the screen cannot show but the total still
// adds. A source in two is a line shown twice.
// ---------------------------------------------------------------------------

for (const s of BUDGET_SOURCES) {
  check(
    `source "${s}" is in exactly one section`,
    BUDGET_SECTIONS.filter((sec) => sec.sources.includes(s)).length,
    1,
  );
}
check(
  "no section names a source that does not exist",
  BUDGET_SECTIONS.flatMap((sec) => sec.sources).filter(
    (s) => !(BUDGET_SOURCES as readonly string[]).includes(s),
  ),
  [],
);
check(
  "the sections, in rail order",
  BUDGET_SECTIONS.map((s) => [s.key, s.label, [...s.sources]]),
  [
    ["purchase", "Purchase Rates", ["yarn", "fabric", "material"]],
    ["process", "Process Rates", ["yarn_process", "fabric_process", "material_process", "garment_process"]],
    ["cmt", "CMTs", ["cmt"]],
    ["expense", "Other Expenses", ["expense"]],
    ["income", "Other Incomes", ["income"]],
  ],
);
check(
  "Purchase Rates' tabs are exactly its section's sources, in order",
  PURCHASE_TABS.map((t) => t.source),
  [...BUDGET_SECTIONS.find((s) => s.key === "purchase")!.sources],
);
check(
  "the tab labels",
  PURCHASE_TABS.map((t) => t.label),
  ["Yarn Purchases", "Fabric Purchases", "Accessories Purchases"],
);
check(
  "Process Rates' tabs are exactly its section's sources, in order",
  PROCESS_TABS.map((t) => t.source),
  [...BUDGET_SECTIONS.find((s) => s.key === "process")!.sources],
);
check(
  "the process tab labels",
  PROCESS_TABS.map((t) => t.label),
  ["Yarn Processes", "Fabric Processes", "Accessories Processes", "Garment Processes"],
);

// ---------------------------------------------------------------------------
// 11. THE SALES HALF OF THE BOTTOM BAR
//
// One answer for the group, or a sentence saying why there isn't one — never
// the first order's value standing in for all of them.
// ---------------------------------------------------------------------------

const so = (
  label: string,
  qty: number | null,
  gross_value: number | null,
  currency_code: string | null = "USD",
  ex_rate: number | null = 84,
  unit: string | null = "PCS",
): SalesOrderFacts => ({ label, qty, unit, currency_code, ex_rate, gross_value });

const TWO_USD = [so("SC-1", 1000, 3100), so("SC-2", 3000, 9900)];

check("one currency across the group", salesSummary(TWO_USD).currency, "USD");
check("one conv across the group", salesSummary(TWO_USD).conv, 84);
check("qty is added", salesSummary(TWO_USD).qty, 4000);
check("one unit", salesSummary(TWO_USD).unit, "PCS");
/* WEIGHTED: 13,000 / 4,000 = 3.25. The flat mean of the two order prices
   (3.10 and 3.30) is 3.20 — the answer that weights a 1,000-piece order the
   same as a 3,000-piece one. */
check("avg price is Σ gross / Σ qty", salesSummary(TWO_USD).avgPrice, 3.25);
refute("…never the flat mean of the order prices", salesSummary(TWO_USD).avgPrice, 3.2);
check("an INR group converts at 1", salesSummary([so("SC-1", 10, 100, "INR", 0)]).conv, 1);
check(
  "units compare case-insensitively",
  salesSummary([so("SC-1", 1, 1), so("SC-2", 1, 1, "USD", 84, "pcs")]).unit,
  "PCS",
);

const MIXED_CCY = [so("SC-1", 1000, 3100), so("SC-2", 1000, 4000, "EUR", 92)];
check("mixed currencies refuse", refusalOf(salesSummary(MIXED_CCY).currency), "Mixed currencies across orders");
check(
  "…and so does conv — a rate is a rate OF a currency",
  refusalOf(salesSummary(MIXED_CCY).conv),
  "Mixed currencies across orders",
);
check(
  "…and the average price, with the currency's reason",
  refusalOf(salesSummary(MIXED_CCY).avgPrice),
  "Mixed currencies across orders",
);
refute("…never 3.55 of nothing", salesSummary(MIXED_CCY).avgPrice, 3.55);
check("the qty still adds — two currencies can count one unit", salesSummary(MIXED_CCY).qty, 2000);

check(
  "one currency at two rates refuses the conv",
  refusalOf(salesSummary([so("SC-1", 1, 1), so("SC-2", 1, 1, "USD", 85)]).conv),
  "Orders use different exchange rates",
);
check(
  "a 0 exchange rate names the order",
  refusalOf(salesSummary([so("SC-1", 1, 1), so("SC-2", 1, 1, "USD", 0)]).conv),
  "SC-2 has no exchange rate",
);
check(
  "a blank order currency is not assumed INR",
  refusalOf(salesSummary([so("SC-1", 1, 1, null)]).currency),
  "SC-1 has no currency",
);

const MIXED_UNIT = [so("SC-1", 1000, 3100), so("SC-2", 200, 2400, "USD", 84, "PACK")];
check("mixed units refuse", refusalOf(salesSummary(MIXED_UNIT).unit), "Orders use different units");
check("…pieces and packs are not added", refusalOf(salesSummary(MIXED_UNIT).qty), "Orders use different units");
refute("…never 1,200 of nothing", salesSummary(MIXED_UNIT).qty, 1200);
check("…and there is no average price", refusalOf(salesSummary(MIXED_UNIT).avgPrice), "Orders use different units");

const ZERO_QTY = [so("SC-1", 1000, 3100), so("SC-2", 0, 0)];
check("a zero-qty order refuses the qty and names it", refusalOf(salesSummary(ZERO_QTY).qty), "SC-2 has no quantity");
check("…and the average, rather than dividing", refusalOf(salesSummary(ZERO_QTY).avgPrice), "SC-2 has no quantity");
refute("…never averaging the rest", salesSummary(ZERO_QTY).avgPrice, 3.1);
check(
  "a missing gross value refuses the average — no partial average",
  refusalOf(salesSummary([so("SC-1", 1000, 3100), so("SC-2", 1000, null)]).avgPrice),
  "SC-2 has no gross value",
);

const NONE = salesSummary([]);
check(
  "no orders refuses every figure",
  [NONE.currency, NONE.conv, NONE.qty, NONE.unit, NONE.avgPrice].map(refusalOf),
  Array(5).fill("No orders in this budget yet"),
);
refute("…and never says the group is 0 pieces", NONE.qty, 0);

// ---------------------------------------------------------------------------
// 12. REQD IS qty x No of Pcs x No of Units (0573)
//
// Garment Processes price per operation: 5,601 garments with two pockets
// printed is 11,202 prints. Blank multipliers are 1, which is what leaves every
// other source's arithmetic exactly as it was.
// ---------------------------------------------------------------------------

const garment = (qty: number | null, pcs: number | null, units: number | null, rate: number | null): BudgetLineInput => ({
  source: "garment_process",
  qty,
  rate,
  no_of_pcs: pcs,
  no_of_units: units,
});

check("garment Reqd is 5,601 x 2 pcs x 1 unit", lineReqd(garment(5601, 2, 1, 3)), 11_202);
check("…and its amount is Reqd x ₹3", lineAmount(garment(5601, 2, 1, 3)), 33_606);
refute("…not qty x rate, which forgets the second pocket", lineAmount(garment(5601, 2, 1, 3)), 16_803);
check("blank pcs and units are 1", lineReqd(garment(5601, null, null, 3)), 5601);
check("a line with neither field at all is unchanged", lineAmount(line("fabric", 1000, 200)), 200_000);
check(
  "a 0 No of Pcs refuses rather than costing the step at nothing",
  refusalOf(lineAmount(garment(5601, 0, 1, 3))),
  "No of Pcs must be more than 0 — leave it blank for 1",
);
check(
  "a negative No of Units refuses and names the box",
  refusalOf(lineReqd(garment(5601, 2, -1, 3))),
  "No of Units must be more than 0 — leave it blank for 1",
);
check(
  "qty is still the first question, with the same sentence",
  refusalOf(lineReqd(garment(null, 0, 0, 3))),
  "Enter a quantity — use 1 for a lump sum",
);
check(
  "a FOC garment step still needs its Reqd to be answerable",
  refusalOf(lineAmount({ ...garment(5601, 0, 1, null), is_foc: true })),
  "No of Pcs must be more than 0 — leave it blank for 1",
);
check("Reqd is not rounded — it is kilograms", lineReqd({ source: "yarn_process", qty: 12.3456, rate: 1 }), 12.3456);

// ---------------------------------------------------------------------------
// 13. A FLAT RATE IS THE CHARGE
//
// ₹4,000 to compact the whole lot. Multiplied by 850 kg it is ₹34 lakh.
// ---------------------------------------------------------------------------

const flat = (qty: number | null, rate: number | null, more: Partial<BudgetLineInput> = {}): BudgetLineInput => ({
  source: "fabric_process",
  qty,
  rate,
  rate_type: "flat",
  ...more,
});

check("a flat line's amount is its rate", lineAmount(flat(850, 4000)), 4000);
refute("…never rate x qty", lineAmount(flat(850, 4000)), 3_400_000);
check("…and needs no quantity at all", lineAmount(flat(null, 4000)), 4000);
check("…nor pcs / units, which it ignores", lineAmount(flat(850, 4000, { no_of_pcs: 0 })), 4000);
check("a flat FOC line is 0", lineAmount(flat(850, 4000, { is_foc: true })), 0);
check("…even with no rate", lineAmount(flat(null, null, { is_foc: true })), 0);
check(
  "a flat line with no rate refuses as any line does",
  refusalOf(lineAmount(flat(850, null))),
  "Enter a rate",
);
check("a flat foreign charge converts", lineAmount(flat(null, 50, { currency_code: "USD", ex_rate: 84 })), 4200);
check(
  "…and asks for its exchange rate",
  refusalOf(lineAmount(flat(null, 50, { currency_code: "USD", ex_rate: null }))),
  "Enter the exchange rate for USD",
);
check(
  "a flat line reaches the cost total once",
  budgetTotals([...LINES, flat(850, 4000)], ORDERS).costBySource.fabric_process,
  4000,
);

// ---------------------------------------------------------------------------
// 14. For = Processwise / Fabricwise / Colorwise — the same kilograms each way
// ---------------------------------------------------------------------------

/* Three fabrics x two colours; SJ has no item id, and one row has no combo.
   Totals: 100+50+80+40+30+20.5 = 320.5 kg. */
const BREAKDOWN: FabricProcessRow[] = [
  { item_id: "f-1", fabric_name: "PIQUE", combo: "NAVY", qty: 100 },
  { item_id: "f-1", fabric_name: "PIQUE", combo: "WHITE", qty: 50 },
  { item_id: "f-2", fabric_name: "RIB", combo: "NAVY", qty: 80 },
  { item_id: "f-2", fabric_name: "RIB", combo: "WHITE", qty: 40 },
  { item_id: null, fabric_name: "SJ", combo: "NAVY", qty: 30 },
  { item_id: null, fabric_name: "SJ", combo: null, qty: 20.5 },
];
const sumQty = (ls: { qty: number }[]) => ls.reduce((a, l) => a + l.qty, 0);

check("Processwise is one line over everything", splitFabricProcess(BREAKDOWN, "process"), [
  { basis: "process", item_id: null, combo: null, description: "All fabrics", qty: 320.5 },
]);
check("Fabricwise is one line per fabric, in first-appearance order", splitFabricProcess(BREAKDOWN, "fabric"), [
  { basis: "fabric", item_id: "f-1", combo: null, description: "PIQUE", qty: 150 },
  { basis: "fabric", item_id: "f-2", combo: null, description: "RIB", qty: 120 },
  { basis: "fabric", item_id: null, combo: null, description: "SJ", qty: 50.5 },
]);
check("Colorwise is one line per combo, a blank combo its own line", splitFabricProcess(BREAKDOWN, "color"), [
  { basis: "color", item_id: null, combo: "NAVY", description: "NAVY", qty: 210 },
  { basis: "color", item_id: null, combo: "WHITE", description: "WHITE", qty: 90 },
  { basis: "color", item_id: null, combo: null, description: "No colour", qty: 20.5 },
]);
check(
  "Σqty is the same at every grain — switching For moves lines, not weight",
  (["process", "fabric", "color"] as const).map((b) => sumQty(splitFabricProcess(BREAKDOWN, b))),
  [320.5, 320.5, 320.5],
);
check(
  "kilograms are not rounded",
  splitFabricProcess([{ item_id: "f-1", fabric_name: "PIQUE", combo: "NAVY", qty: 0.1 }, { item_id: "f-1", fabric_name: "PIQUE", combo: "NAVY", qty: 0.2 }], "fabric")[0].qty,
  0.1 + 0.2,
);
check("an empty breakdown is no lines, not a line of 0 kg", splitFabricProcess([], "process"), []);

// ---------------------------------------------------------------------------
// 15. A PULLED LINE'S KEY INCLUDES ITS PROCESS
//
// Keyed on (source, order, item), a yarn that is dyed AND twisted was one line,
// and the second step's cost left the total.
// ---------------------------------------------------------------------------

const DYE = { source: "yarn_process", garment_order_id: "o-1", item_id: "y-1", process_id: "p-dye" };
const TWIST = { ...DYE, process_id: "p-twist" };

refute("two processes on one yarn are two keys", pulledLineKey(DYE), pulledLineKey(TWIST));
check(
  "the key is the eight fields, nulls as blank",
  pulledLineKey({ ...DYE, combo: null }),
  "yarn_process|o-1|y-1|p-dye||||",
);
refute(
  "two colours of one fabric process are two keys",
  pulledLineKey({ source: "fabric_process", garment_order_id: "o-1", item_id: null, process_id: "p", combo: "NAVY", basis: "color" }),
  pulledLineKey({ source: "fabric_process", garment_order_id: "o-1", item_id: null, process_id: "p", combo: "WHITE", basis: "color" }),
);
check(
  "a pre-0573 line keys on its three fields with empty tails",
  pulledLineKey({ source: "material", garment_order_id: "o-1", item_id: "m-1" }),
  "material|o-1|m-1|||||",
);
/* APPENDED, NOT INSERTED: the style and component go on the END, so a key
   built from the first six fields is still the start of the new one — its
   shape is the same, only longer. */
check(
  "…and keeps the six-field key's shape as its prefix",
  pulledLineKey({ source: "material", garment_order_id: "o-1", item_id: "m-1" }).startsWith("material|o-1|m-1|||"),
  true,
);

/* A GARMENT STEP HAS NO ITEM AND NO COMBO. Without its style and component,
   one print on two styles — or on two parts of one style — was one key, and
   the screen dropped the second line with its cost. */
const PRINT = {
  source: "garment_process",
  garment_order_id: "o-1",
  item_id: null,
  process_id: "p-print",
  style_ref_no: "TSH-001",
  component_id: null,
};
refute(
  "one process on two styles of one order is two keys",
  pulledLineKey(PRINT),
  pulledLineKey({ ...PRINT, style_ref_no: "TSH-002" }),
);
refute(
  "one process on two components of one style is two keys",
  pulledLineKey({ ...PRINT, component_id: "c-chest" }),
  pulledLineKey({ ...PRINT, component_id: "c-sleeve" }),
);
check(
  "the style and component are the last two fields",
  pulledLineKey({ ...PRINT, component_id: "c-chest" }),
  "garment_process|o-1||p-print|||TSH-001|c-chest",
);

// ---------------------------------------------------------------------------
// 16. A RATE CARRIES ACROSS A RE-SPLIT ONLY WHEN IT WAS ONE RATE
// ---------------------------------------------------------------------------

const r = (rate: number | null, more: Partial<BudgetLineInput> = {}) => ({ rate, ...more });

check("one shared rate carries", carryRate([r(12), r(12), r(12)]), {
  rate: 12,
  currency_code: null,
  ex_rate: null,
  rate_type: "per_unit",
});
check("two rates carry nothing — no rate the operator never typed", carryRate([r(12), r(14)]), null);
check(
  "a foreign rate carries WITH its currency and exchange rate",
  carryRate([r(0.15, { currency_code: "USD", ex_rate: 84 }), r(0.15, { currency_code: "usd", ex_rate: 84 })]),
  { rate: 0.15, currency_code: "USD", ex_rate: 84, rate_type: "per_unit" },
);
check(
  "the same number in two currencies is not one rate",
  carryRate([r(0.15, { currency_code: "USD", ex_rate: 84 }), r(0.15)]),
  null,
);
check(
  "one currency at two exchange rates is not one rate",
  carryRate([r(0.15, { currency_code: "USD", ex_rate: 84 }), r(0.15, { currency_code: "USD", ex_rate: 85 })]),
  null,
);
check(
  "a blank currency and INR are the same rate, carried as NULL / NULL",
  carryRate([r(12), r(12, { currency_code: "INR", ex_rate: 1 })]),
  { rate: 12, currency_code: null, ex_rate: null, rate_type: "per_unit" },
);
/* A FLAT CHARGE NEVER CARRIES: ₹4,000 for "All fabrics" handed to three
   per-fabric lines is ₹12,000. */
check("a flat charge does not carry", carryRate([r(4000, { rate_type: "flat" })]), null);
check("a group with no rate has nothing to carry", carryRate([r(null), r(null)]), null);
check("no lines, nothing to carry", carryRate([]), null);

// ---------------------------------------------------------------------------
// 17. A CMT BREAKUP IS THE RATE, TO THE 4TH PLACE (0574)
//
// The database holds `rate = Σ breakup` on numeric(14,4). A total that differs
// from the stored columns in the fourth place is a save Postgres rejects over a
// digit nobody typed.
// ---------------------------------------------------------------------------

check(
  "the five operations, 'Sewing / Making' as ONE",
  CMT_OPERATIONS.map((o) => [o.key, o.label]),
  [
    ["cutting_rate", "Cutting"],
    ["making_rate", "Sewing / Making"],
    ["checking_rate", "Checking"],
    ["ironing_rate", "Ironing"],
    ["packing_rate", "Packing"],
  ],
);

check("all blank is no breakup — the typed rate stands", cmtBreakupTotal({}), null);
check(
  "nulls are blank too",
  cmtBreakupTotal({ cutting_rate: null, making_rate: null, checking_rate: undefined }),
  null,
);
check("one operation is that operation", cmtBreakupTotal({ making_rate: 8.5 }), 8.5);
check(
  "five operations add up",
  cmtBreakupTotal({ cutting_rate: 1.5, making_rate: 8, checking_rate: 0.75, ironing_rate: 1, packing_rate: 1.25 }),
  12.5,
);
check("0.1 + 0.2 is 0.3, exactly", cmtBreakupTotal({ cutting_rate: 0.1, making_rate: 0.2 }), 0.3);
refute("…not 0.30000000000000004", cmtBreakupTotal({ cutting_rate: 0.1, making_rate: 0.2 }), 0.1 + 0.2);
check("a value rounds to 4dp, as the column stores it", cmtBreakupTotal({ ironing_rate: 1.23456 }), 1.2346);
const FIVE_ODD = {
  cutting_rate: 1.23456,
  making_rate: 1.23456,
  checking_rate: 1.23456,
  ironing_rate: 1.23456,
  packing_rate: 1.23456,
};
/* EACH VALUE IS ROUNDED FIRST. Postgres stores five 1.2346s, which sum to
   6.1730; rounding only the raw sum (6.1728) gives a rate the check rejects. */
check("five such values sum as STORED: 5 x 1.2346", cmtBreakupTotal(FIVE_ODD), 6.173);
refute("…not the raw sum rounded once", cmtBreakupTotal(FIVE_ODD), 6.1728);
/* 12.34565 x 1e4 is 123456.49999999999 in binary, so Math.round(n x 1e4) gives
   12.3456 — one ten-thousandth short of what Postgres stores. */
check(
  "half rounds up on the decimal typed, as Postgres does (12.34565 → 12.3457)",
  cmtBreakupTotal({ packing_rate: 12.34565 }),
  12.3457,
);
refute("…not the binary 12.3456", cmtBreakupTotal({ packing_rate: 12.34565 }), 12.3456);
/* The same helper the Zod schema rounds each stored column with, so a column
   and the rate it sums to can never be rounded by two different rules. */
check(
  "round4 is the rule the breakup is summed with",
  [round4(12.34565), round4(1.23456), round4(0.1 + 0.2), round4(7)],
  [12.3457, 1.2346, 0.3, 7],
);
check(
  "a negative operation refuses and names it",
  refusalOf(cmtBreakupTotal({ cutting_rate: 1, making_rate: -2 })),
  "Sewing / Making rate cannot be negative",
);
check("a breakup of zeros is 0 — operations done free", cmtBreakupTotal({ ironing_rate: 0, packing_rate: 0 }), 0);
refute("…not null, which would mean no breakup", cmtBreakupTotal({ ironing_rate: 0, packing_rate: 0 }), null);

/* The blueprint's own figures: SQ Qty 5,321 (not Order Qty 5,028) x ₹12.50. */
check(
  "a CMT line is SQ Qty x rate",
  lineAmount({ source: "cmt", qty: 5321, rate: 12.5 }),
  66_512.5,
);
check(
  "…and its breakup, fed back as the rate, gives the same amount",
  lineAmount({
    source: "cmt",
    qty: 5321,
    rate: cmtBreakupTotal({
      cutting_rate: 1.5,
      making_rate: 8,
      checking_rate: 0.75,
      ironing_rate: 1,
      packing_rate: 1.25,
    }) as number,
  }),
  66_512.5,
);

// ---------------------------------------------------------------------------
// 18. A PERCENT LINE IS A SHARE OF SALES — OF THE RIGHT SCOPE
//
// The client's own figures: Gross Sales 38,85,638.40 (5,028 x $9.20 x 84).
// ---------------------------------------------------------------------------

const GROSS = 3_885_638.4;
/* One order, two styles. Style values add to the order's; the group is the order. */
const PCT_ORDERS: BudgetOrderInput[] = [
  {
    id: "o-1",
    label: "SC-1",
    sales_value: GROSS,
    refusal: null,
    styles: [
      { style_ref_no: "TSH-001", sales_value: 2_885_638.4, refusal: null },
      { style_ref_no: "TSH-002", sales_value: 1_000_000, refusal: null },
    ],
  },
];
const pctLine = (rate: number | null, more: Partial<BudgetLineInput> = {}): BudgetLineInput => ({
  source: "expense",
  qty: null,
  rate,
  rate_type: "percent",
  ...more,
});
const PCT_BASE = salesBaseOf(PCT_ORDERS);

check("2.5% of the whole budget", lineAmount(pctLine(2.5, { source: "income" }), PCT_BASE), 97_140.96);
check(
  "…is the income the client's sheet shows",
  budgetTotals([pctLine(2.5, { source: "income" })], PCT_ORDERS).income,
  97_140.96,
);
check("2% of one order", lineAmount(pctLine(2, { garment_order_id: "o-1" }), PCT_BASE), 77_712.77);
check(
  "2% of one style — its own sales, not the order's",
  lineAmount(pctLine(2, { garment_order_id: "o-1", style_ref_no: "tsh-002 " }), PCT_BASE),
  20_000,
);
refute(
  "…never the order's 77,712.77 charged as though it were the style's",
  lineAmount(pctLine(2, { garment_order_id: "o-1", style_ref_no: "TSH-002" }), PCT_BASE),
  77_712.77,
);
check(
  "a style with no per-style value refuses and says where to charge it",
  refusalOf(lineAmount(pctLine(2, { garment_order_id: "o-1", style_ref_no: "TSH-999" }), PCT_BASE)),
  "This style's own sales value isn't known — charge it on the order instead",
);
check(
  "…and so does any style, when the caller passed no styles at all",
  refusalOf(
    lineAmount(
      pctLine(2, { garment_order_id: "o-1", style_ref_no: "TSH-001" }),
      salesBaseOf([order("SC-1", GROSS)].map((o) => ({ ...o, id: "o-1" }))),
    ),
  ),
  "This style's own sales value isn't known — charge it on the order instead",
);
check(
  "a percent line reads no qty, pcs, units, currency or exchange rate",
  lineAmount(
    pctLine(2.5, { qty: 0, no_of_pcs: -1, currency_code: "USD", ex_rate: null, source: "income" }),
    PCT_BASE,
  ),
  97_140.96,
);
check("a FOC percent line is 0, with or without a base", lineAmount(pctLine(5, { is_foc: true })), 0);
check(
  "without a resolver a percent line refuses",
  refusalOf(lineAmount(pctLine(2))),
  "A percentage needs the sales value",
);
refute("…rather than answering 0", lineAmount(pctLine(2)), 0);
check(
  "more than 100% refuses",
  refusalOf(lineAmount(pctLine(120), PCT_BASE)),
  "A percentage cannot be more than 100",
);
check("exactly 100% is allowed", lineAmount(pctLine(100), PCT_BASE), GROSS);
check(
  "a negative percentage uses the negative-rate sentence",
  refusalOf(lineAmount(pctLine(-2), PCT_BASE)),
  "A rate cannot be negative — use Other income instead",
);
check("…and a blank one asks for the rate", refusalOf(lineAmount(pctLine(null), PCT_BASE)), "Enter a rate");

check("per_unit is unchanged by any of this", lineAmount(line("cmt", 5321, 12.5), PCT_BASE), 66_512.5);
check("flat is unchanged by any of this", lineAmount(flat(850, 4000), PCT_BASE), 4000);

// ---------------------------------------------------------------------------
// 19. PENDING IS NOT UNPRICED — AND COST STILL REFUSES OVER IT
//
// A percent line waiting on a sales value the operator cannot fix HERE must not
// hold Save (it is not unpriced). But the cost total without it is the smaller,
// plausible, believed figure — so cost refuses and names the line.
// ---------------------------------------------------------------------------

const BAD_SALES = [
  { ...order("SC-1", 300_000), id: "o-1" },
  { ...order("SC-2", null, "two prices for one style"), id: "o-2" },
];
const COMMISSION = pctLine(5, { description: "Agent commission" });
const WAITING = budgetTotals([...LINES, COMMISSION], BAD_SALES);

check("a percent line waiting on sales is pending", WAITING.pending, [
  {
    index: 2,
    reason: "Agent commission: no sales value to take 5% of — SC-2: two prices for one style",
    field: "base",
  },
]);
check("…and is NOT in unpriced", WAITING.unpriced, []);
check(
  "cost refuses and names the line",
  refusalOf(WAITING.cost),
  "Agent commission: no sales value to take 5% of — SC-2: two prices for one style",
);
refute("…never the 250,000 it could add up without it", WAITING.cost, 250_000);
check(
  "only that line's source refuses; the rest of the breakdown answers",
  [refusalOf(WAITING.costBySource.expense), WAITING.costBySource.fabric, WAITING.costBySource.material],
  ["Agent commission: no sales value to take 5% of — SC-2: two prices for one style", 200_000, 50_000],
);
check("income is untouched by a pending COST line", WAITING.income, 0);

/* Sales fine, but an order-scoped line points at an order no longer in the
   group — so COST is the first refusal, and profit says it was cost. */
const ORPHAN = budgetTotals(
  [...LINES, pctLine(3, { garment_order_id: "o-gone" })],
  ORDERS.map((o, i) => ({ ...o, id: `o-${i + 1}` })),
);
check(
  "a line whose order left the group is pending, named by position",
  ORPHAN.pending.map((p) => p.reason),
  ["Line 3: no sales value to take 3% of — This line's order is no longer in this budget"],
);
check(
  "profit refuses and says it was COST",
  refusalOf(ORPHAN.profit),
  "Cost can't be totalled — Line 3: no sales value to take 3% of — This line's order is no longer in this budget",
);
check("…and the margin with it", refusalOf(ORPHAN.profitPct), refusalOf(ORPHAN.profit));
check("sales itself still answers", ORPHAN.sales, 500_000);

const INCOME_WAITING = budgetTotals(
  [...LINES, pctLine(2, { source: "income", garment_order_id: "o-1", style_ref_no: "X" })],
  ORDERS.map((o, i) => ({ ...o, id: `o-${i + 1}` })),
);
check(
  "a pending INCOME line refuses income, not cost",
  [INCOME_WAITING.cost, refusalOf(INCOME_WAITING.income)],
  [
    250_000,
    "Line 3: no sales value to take 2% of — This style's own sales value isn't known — charge it on the order instead",
  ],
);
check(
  "…and profit says it was INCOME",
  refusalOf(INCOME_WAITING.profit)?.startsWith("Income can't be totalled — Line 3:"),
  true,
);

/* A TRULY UNPRICED LINE STILL BEHAVES AS IT ALWAYS DID: excluded, counted, and
   the cost total keeps answering — Save is what holds it, not the total. */
const PCT_BLANK = budgetTotals([...LINES, pctLine(null)], ORDERS);
check("a percent line with no rate is unpriced", PCT_BLANK.unpriced, [
  { index: 2, reason: "Enter a rate", field: "rate" },
]);
check("…not pending", PCT_BLANK.pending, []);
check("…and cost still answers without it", PCT_BLANK.cost, 250_000);

// ---------------------------------------------------------------------------
// 20. GENERAL — the one-page summary
// ---------------------------------------------------------------------------

check(
  "the General categories",
  GENERAL_CATEGORIES.map((c) => [c.key, c.label, [...c.sources]]),
  [
    ["yarn", "Yarn", ["yarn"]],
    ["fabric", "Fabric", ["fabric"]],
    ["accessories", "Accessories", ["material"]],
    ["processing", "Processing", ["yarn_process", "fabric_process", "material_process", "garment_process"]],
    ["cmt", "CMT", ["cmt"]],
    ["other", "Other Expenses", ["expense"]],
  ],
);
/* THE MATRIX TOTAL IS COST because every cost source is in exactly one row,
   and income in none. */
for (const s of BUDGET_SOURCES) {
  check(
    `source "${s}" is in ${s === "income" ? "no" : "exactly one"} General category`,
    GENERAL_CATEGORIES.filter((c) => c.sources.includes(s)).length,
    s === "income" ? 0 : 1,
  );
}

/* The client's sheet: cost 31,75,000 against sales 38,85,638.40, SQ Qty 5,321. */
const CLIENT_LINES: BudgetLineInput[] = [
  line("yarn", 1, 1_200_000),
  line("fabric", 1, 300_000),
  line("material", 1, 400_000),
  line("yarn_process", 1, 150_000),
  line("fabric_process", 1, 350_000),
  line("garment_process", 1, 50_000),
  line("cmt", 1, 625_000),
  line("expense", 1, 100_000),
];
const CLIENT = budgetTotals(CLIENT_LINES, [order("SC-1", GROSS)]);
const GENERAL = generalSummary(CLIENT, 5321);

check("the client's cost", CLIENT.cost, 3_175_000);
check("the client's profit: 38,85,638.40 − 31,75,000", CLIENT.profit, 710_638.4);
check("the client's margin", CLIENT.profitPct, 18.29);
check(
  "the matrix rows add up to cost",
  GENERAL.rows.reduce((a, r) => a + (r.amount as number), 0),
  CLIENT.cost,
);
check("…and its total IS cost", GENERAL.total.amount, CLIENT.cost);
check(
  "each category as a share of sales, 2dp",
  GENERAL.rows.map((r) => [r.key, r.amount, r.pctOfSales]),
  [
    ["yarn", 1_200_000, 30.88],
    ["fabric", 300_000, 7.72],
    ["accessories", 400_000, 10.29],
    ["processing", 550_000, 14.15],
    ["cmt", 625_000, 16.08],
    ["other", 100_000, 2.57],
  ],
);
check("the total's share", GENERAL.total.pctOfSales, 81.71);
check("the bottom line carries through", [GENERAL.sales, GENERAL.profit, GENERAL.marginPct], [GROSS, 710_638.4, 18.29]);
check("cost per piece MADE is cost ÷ SQ Qty", GENERAL.costPerPiece, 596.69);
refute("…not ÷ the 5,028 ordered", GENERAL.costPerPiece, 631.46);
check(
  "a zero SQ Qty refuses the cost per piece",
  refusalOf(generalSummary(CLIENT, 0).costPerPiece),
  "No SQ Qty to spread the cost over",
);
check(
  "a refused SQ Qty carries its own sentence",
  refusalOf(generalSummary(CLIENT, { refused: "SC-1: no approval quantities yet" }).costPerPiece),
  "SC-1: no approval quantities yet",
);
check(
  "a refused cost refuses the cost per piece",
  refusalOf(generalSummary(WAITING, 5321).costPerPiece),
  refusalOf(WAITING.cost),
);
check(
  "a category with a pending line refuses; the others answer",
  generalSummary(WAITING, 5321).rows.map((r) => (isRefusal(r.amount) ? "refused" : r.amount)),
  [0, 200_000, 50_000, 0, 0, "refused"],
);
check(
  "shares refuse when sales does — no percentage of an unknown",
  refusalOf(generalSummary(WAITING, 5321).rows[1].pctOfSales),
  "SC-2: two prices for one style",
);
check(
  "shares refuse on zero sales rather than printing 0%",
  refusalOf(generalSummary(budgetTotals(LINES, [order("SC-1", 0)]), 100).rows[1].pctOfSales),
  "No sales value to measure against",
);

// ---------------------------------------------------------------------------
// 21. EVERY LINE REFUSAL NAMES ITS FIELD (2026-09-18)
//
// A bare sentence can only be printed where the figure goes, which put "Enter
// a rate" in the Amount column. Each refusal now says which box it is about —
// and the SENTENCES and their ORDER are exactly what sections 5–19 pin.
// ---------------------------------------------------------------------------

const fieldOf = (v: unknown) => (isRefusal(v) ? [(v as Refusal).field ?? null, v.refused] : null);

check("blank qty → qty", fieldOf(lineAmount({ source: "expense", qty: null, rate: 5 })), [
  "qty",
  "Enter a quantity — use 1 for a lump sum",
]);
check("0 No of Pcs → no_of_pcs", fieldOf(lineReqd(garment(5601, 0, 1, 3))), [
  "no_of_pcs",
  "No of Pcs must be more than 0 — leave it blank for 1",
]);
check("0 No of Units → no_of_units", fieldOf(lineAmount(garment(5601, 2, 0, 3))), [
  "no_of_units",
  "No of Units must be more than 0 — leave it blank for 1",
]);
check("blank rate → rate", fieldOf(lineInrRate({ source: "fabric", qty: 1, rate: null })), [
  "rate",
  "Enter a rate",
]);
check("negative rate → rate", fieldOf(lineAmount(line("expense", 1, -5))), [
  "rate",
  "A rate cannot be negative — use Other income instead",
]);
check("missing exchange rate → ex_rate", fieldOf(lineAmount(fx(1000, 3, "USD", null))), [
  "ex_rate",
  "Enter the exchange rate for USD",
]);
check("percent over 100 → rate", fieldOf(lineAmount(pctLine(120), PCT_BASE)), [
  "rate",
  "A percentage cannot be more than 100",
]);
check("percent with no resolver → base", fieldOf(lineAmount(pctLine(2))), [
  "base",
  "A percentage needs the sales value",
]);
check(
  "percent waiting on a style's sales → base, with the base's own sentence",
  fieldOf(lineAmount(pctLine(2, { garment_order_id: "o-1", style_ref_no: "TSH-999" }), PCT_BASE)),
  ["base", "This style's own sales value isn't known — charge it on the order instead"],
);
check("a flat line with no rate → rate", fieldOf(lineAmount(flat(850, null))), ["rate", "Enter a rate"]);

/* THE ORDER IS UNCHANGED: a line wrong in three places names the FIRST one —
   qty before pcs before rate before exchange rate. */
check(
  "the first refusal wins, in the pinned order",
  fieldOf(lineAmount({ source: "garment_process", qty: null, rate: null, no_of_pcs: 0, currency_code: "USD" })),
  ["qty", "Enter a quantity — use 1 for a lump sum"],
);
check(
  "…pcs before rate",
  fieldOf(lineAmount({ ...garment(5601, 0, 1, null), currency_code: "USD" })),
  ["no_of_pcs", "No of Pcs must be more than 0 — leave it blank for 1"],
);
check(
  "…rate before exchange rate",
  fieldOf(lineAmount(fx(1000, null, "USD", null))),
  ["rate", "Enter a rate"],
);

check(
  "a CMT operation's refusal names the operation",
  fieldOf(cmtBreakupTotal({ cutting_rate: 1, ironing_rate: -1 })),
  ["ironing_rate", "Ironing rate cannot be negative"],
);

/* A TOTAL's refusal is about no single field, and says so by having none. */
check(
  "a TOTAL's refusal (sales) has no field",
  fieldOf(budgetTotals(LINES, []).sales),
  [null, "No orders in this budget yet"],
);
check(
  "a source refusal (not a line field) leaves field out of its unpriced entry",
  budgetTotals([{ source: null, qty: 1, rate: 5 }], ORDERS).unpriced,
  [{ index: 0, reason: "Choose what this line is for" }],
);
check(
  "unpriced entries carry the field the cursor should land on",
  budgetTotals(
    [line("fabric", 1000, 200), { source: "yarn", qty: 5, rate: 3, currency_code: "EUR" }, garment(10, 0, 1, 3)],
    ORDERS,
  ).unpriced,
  [
    { index: 1, reason: "Enter the exchange rate for EUR", field: "ex_rate" },
    {
      index: 2,
      reason: "No of Pcs must be more than 0 — leave it blank for 1",
      field: "no_of_pcs",
    },
  ],
);
check("pending entries carry field base", WAITING.pending.map((p) => p.field), ["base"]);

// lineProblem: lineAmount's first refusal, read for its field.
check("lineProblem on a good line is null", lineProblem(line("fabric", 1000, 200)), null);
check("lineProblem on a FOC line is null", lineProblem({ source: "material", qty: 5, rate: null, is_foc: true }), null);
check("lineProblem names the field and the sentence", lineProblem(fx(1000, 3, "USD", 0)), {
  field: "ex_rate",
  message: "Enter the exchange rate for USD",
});
check(
  "lineProblem takes the same base lineAmount does",
  lineProblem(pctLine(2, { garment_order_id: "o-gone" }), PCT_BASE),
  { field: "base", message: "This line's order is no longer in this budget" },
);
check("…and with the base resolved, no problem", lineProblem(pctLine(2), PCT_BASE), null);
/* THE SAME SENTENCE lineAmount gives — never a second wording. */
check(
  "lineProblem's message IS lineAmount's refusal",
  lineProblem(garment(5601, 2, -1, 3))?.message,
  refusalOf(lineAmount(garment(5601, 2, -1, 3))),
);

console.log(failed === 0 ? "\nOK — every budget total vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
