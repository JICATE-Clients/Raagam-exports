/**
 * Vectors for `lib/orders/budget/amendment.ts` — what the MD approves, the
 * sentence a locked order refuses with, and the baseline a reopen is measured
 * against.
 *
 * THE FIGURES HERE ARE THE APPROVAL. The summary is stored at submit and read
 * on a phone; the baseline is what every later change is judged against. Both
 * fail the same dangerous way: a figure that could not be worked out, stored
 * or shown as 0 — "approved at break-even", "no change since approval". So
 * most of these pin a refusal surviving the trip: through the summary, through
 * JSON, into the push text, across a variance.
 *
 * Runs under `tsx` for `check-budget-totals.mts`'s reason.
 */
import {
  AMENDMENT_SOURCES,
  AMENDMENT_TYPES,
  budgetBaseline,
  budgetKpis,
  compareToBaseline,
  kpiNotificationBody,
  kpisFromJson,
  kpisToJson,
  orderLockMessage,
} from "../lib/orders/budget/amendment.ts";
import {
  budgetTotals,
  generalSummary,
  isRefusal,
  salesSummary,
  type BudgetLineInput,
} from "../lib/orders/budget/totals.ts";
import { INITIATED_OPTIONS } from "../lib/orders/amendments/types.ts";

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
const refusalOf = (v: unknown) => (isRefusal(v) ? v.refused : null);

// ---------------------------------------------------------------------------
// Fixtures — the client's own budget
//
// Gross Sales 38,85,638.40 = 5,028 x $9.20 x 84. Cost 31,75,000. Other income
// 2.5% of sales = 97,140.96. Cut Qty (pieces made) 5,321.
// ---------------------------------------------------------------------------

const GROSS = 3_885_638.4;
const line = (source: string, rate: number): BudgetLineInput => ({ source, qty: 1, rate });
const LINES: BudgetLineInput[] = [
  line("yarn", 1_200_000),
  line("fabric", 300_000),
  line("material", 400_000),
  line("yarn_process", 150_000),
  line("fabric_process", 350_000),
  line("garment_process", 50_000),
  line("cmt", 625_000),
  line("expense", 100_000),
  { source: "income", qty: null, rate: 2.5, rate_type: "percent" },
];
const ORDERS = [{ id: "o-1", label: "SC-1", sales_value: GROSS, refusal: null }];
const SALES = salesSummary([
  { label: "SC-1", qty: 5028, unit: "PCS", currency_code: "USD", ex_rate: 84, gross_value: 46_257.6 },
]);
const TOTALS = budgetTotals(LINES, ORDERS);
const GENERAL = generalSummary(TOTALS, 5321);
const KPI_ORDERS = [
  { re_no: "2627/0001", delivery_date: "2026-10-30" },
  { re_no: " 2627/0001 ", delivery_date: "2026-10-30" },
];
const KPIS = budgetKpis({
  entryDate: "2026-09-18",
  orders: KPI_ORDERS,
  sales: SALES,
  totals: TOTALS,
  general: GENERAL,
});

// ---------------------------------------------------------------------------
// 1. The Amendment Protocol vocabulary
// ---------------------------------------------------------------------------

check("sources: By Customer / By Us, stored as short codes", AMENDMENT_SOURCES, [
  { value: "customer", label: "By Customer" },
  { value: "internal", label: "By Us" },
]);
check(
  "…and the labels ARE the order module's own words",
  AMENDMENT_SOURCES.map((s) => s.label),
  [...INITIATED_OPTIONS],
);
check(
  "types: the legacy order_amendments CHECK, + internal_error + other",
  AMENDMENT_TYPES.map((t) => t.value),
  [
    "quantity",
    "colour",
    "price",
    "sizes",
    "delivery_date",
    "consignee",
    "packing",
    "style",
    "internal_error",
    "other",
  ],
);
check(
  "every type has a label",
  AMENDMENT_TYPES.every((t) => t.label.trim() !== ""),
  true,
);

// ---------------------------------------------------------------------------
// 2. The lock message — one sentence, and the trigger raises the same one
// ---------------------------------------------------------------------------

check(
  "the full sentence",
  orderLockMessage({ reNo: "2627/0001", budgetCode: "BDG-0007", approvedAt: "2026-09-18" }),
  "Selected budget has been approved — RE 2627/0001, budget BDG-0007, approved on 18/09/2026. Direct edits are disabled. Raise an Order Revision to change it.",
);
/* 19:00 UTC on the 18th is 00:30 IST on the 19th — the day it was approved in
   the business's own calendar, whatever zone the server runs in. */
check(
  "a timestamp is dated in IST, not the runtime's zone",
  orderLockMessage({ reNo: "2627/0001", budgetCode: "BDG-0007", approvedAt: "2026-09-18T19:00:00Z" }),
  "Selected budget has been approved — RE 2627/0001, budget BDG-0007, approved on 19/09/2026. Direct edits are disabled. Raise an Order Revision to change it.",
);
check(
  "…and an evening approval in IST stays on its own day",
  orderLockMessage({ reNo: "X", budgetCode: null, approvedAt: "2026-09-18T18:29:00+00:00" }),
  "Selected budget has been approved — RE X, approved on 18/09/2026. Direct edits are disabled. Raise an Order Revision to change it.",
);
check(
  "no budget code (none are generated today) drops the code, not the sentence",
  orderLockMessage({ reNo: "2627/0001", budgetCode: "  ", approvedAt: "2026-09-18" }),
  "Selected budget has been approved — RE 2627/0001, approved on 18/09/2026. Direct edits are disabled. Raise an Order Revision to change it.",
);
check(
  "no RE No",
  orderLockMessage({ reNo: null, budgetCode: "BDG-0007", approvedAt: "2026-09-18" }),
  "Selected budget has been approved — budget BDG-0007, approved on 18/09/2026. Direct edits are disabled. Raise an Order Revision to change it.",
);
check(
  "no approval date",
  orderLockMessage({ reNo: "2627/0001", budgetCode: "BDG-0007", approvedAt: null }),
  "Selected budget has been approved — RE 2627/0001, budget BDG-0007. Direct edits are disabled. Raise an Order Revision to change it.",
);

// ---------------------------------------------------------------------------
// 3. The submission summary — read off the totals, never recomputed
// ---------------------------------------------------------------------------

check("RE Nos are distinct and trimmed", KPIS.re_nos, ["2627/0001"]);
check("the entry date is the budget's", KPIS.entry_date, "2026-09-18");
check("delivery dates are distinct", KPIS.delivery_dates, ["2026-10-30"]);
check("order qty is ORDER qty, with its unit", [KPIS.order_qty, KPIS.order_unit], [5028, "PCS"]);
refute("…not the 5,321 pieces made", KPIS.order_qty, 5321);
check("total income = gross sales + other incomes (§3 C)", KPIS.total_income, 3_982_779.36);
check("total expenses = the General total = cost", KPIS.total_expenses, 3_175_000);
check("profit is the totals' own", KPIS.profit, TOTALS.profit);
check("…the client's figure", KPIS.profit, 807_779.36);
/* THE ONE SUM HERE CANNOT DRIFT: Total Income − Total Expenses must BE profit,
   or the summary contradicts itself on the MD's screen. */
check(
  "total income − total expenses IS profit",
  Math.round(((KPIS.total_income as number) - (KPIS.total_expenses as number)) * 100) / 100,
  KPIS.profit,
);
check("margin is the totals' own", KPIS.profit_pct, 20.79);
check("cost per piece is per piece MADE", KPIS.cost_per_piece, 596.69);
check(
  "delivery dates sort earliest first",
  budgetKpis({
    entryDate: null,
    orders: [
      { re_no: "B", delivery_date: "2026-12-01" },
      { re_no: "A", delivery_date: "2026-10-30" },
      { re_no: null, delivery_date: null },
    ],
    sales: SALES,
    totals: TOTALS,
    general: GENERAL,
  }).delivery_dates,
  ["2026-10-30", "2026-12-01"],
);

/* One unvaluable order: sales refuses, so total income, profit and margin all
   refuse with its sentence — and total EXPENSES still answers. */
const BAD_TOTALS = budgetTotals(LINES.slice(0, -1), [
  ...ORDERS,
  { id: "o-2", label: "SC-2", sales_value: null, refusal: "two prices for one style" },
]);
const BAD = budgetKpis({
  entryDate: "2026-09-18",
  orders: KPI_ORDERS,
  sales: SALES,
  totals: BAD_TOTALS,
  general: generalSummary(BAD_TOTALS, 5321),
});
check(
  "an unvaluable order refuses total income",
  refusalOf(BAD.total_income),
  "SC-2: two prices for one style",
);
refute("…never gross sales of the orders it could value", BAD.total_income, GROSS);
check("…and profit, with the same sentence", refusalOf(BAD.profit), "SC-2: two prices for one style");
check("expenses still answer", BAD.total_expenses, 3_175_000);

// ---------------------------------------------------------------------------
// 4. Stored as JSON, a refusal comes back a refusal
// ---------------------------------------------------------------------------

const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));

check("the stored form is versioned", kpisToJson(KPIS).v, 1);
check("a summary survives storage exactly", kpisFromJson(roundTrip(kpisToJson(KPIS))), KPIS);
check(
  "a refused profit is stored as { refused }",
  roundTrip(kpisToJson(BAD)).profit,
  { refused: "SC-2: two prices for one style" },
);
check("…and read back as a refusal", refusalOf(kpisFromJson(roundTrip(kpisToJson(BAD)))!.profit), "SC-2: two prices for one style");
refute("…never as 0", kpisFromJson(roundTrip(kpisToJson(BAD)))!.profit, 0);
check(
  "a field that is neither a number nor a refusal reads as 'Not recorded'",
  kpisFromJson({ profit: "12", total_income: null, cost_per_piece: { refused: 3 } }),
  {
    re_nos: [],
    entry_date: null,
    delivery_dates: [],
    order_qty: { refused: "Not recorded" },
    order_unit: { refused: "Not recorded" },
    total_income: { refused: "Not recorded" },
    total_expenses: { refused: "Not recorded" },
    profit: { refused: "Not recorded" },
    profit_pct: { refused: "Not recorded" },
    cost_per_piece: { refused: "Not recorded" },
  },
);
check("something that is not a summary at all is null", [kpisFromJson(null), kpisFromJson([1])], [null, null]);

// ---------------------------------------------------------------------------
// 5. The phone push — the app's formats, and a refusal in words
// ---------------------------------------------------------------------------

check(
  "the body, four lines",
  kpiNotificationBody(KPIS).split("\n"),
  [
    "RE 2627/0001 · Entry 18/09/2026 · Delivery 30/10/2026",
    "Order Qty 5,028 PCS",
    "Income ₹39,82,779.36 · Expenses ₹31,75,000.00",
    "Profit ₹8,07,779.36 (20.79%) · Cost/pc ₹596.69",
  ],
);
check(
  "a refused profit is said in words, once",
  kpiNotificationBody(BAD).split("\n").slice(2),
  [
    "Income unknown (SC-2: two prices for one style) · Expenses ₹31,75,000.00",
    "Profit unknown (SC-2: two prices for one style) · Cost/pc ₹596.69",
  ],
);
check(
  "a known profit with no margin says why",
  kpiNotificationBody({ ...KPIS, profit_pct: { refused: "No sales value to measure the margin against" } }).split(
    "\n",
  )[3],
  "Profit ₹8,07,779.36 (margin unknown (No sales value to measure the margin against)) · Cost/pc ₹596.69",
);
check(
  "no RE Nos and no dates print a dash, not a blank",
  kpiNotificationBody({ ...KPIS, re_nos: [], entry_date: null, delivery_dates: [] }).split("\n")[0],
  "RE — · Entry — · Delivery —",
);

// ---------------------------------------------------------------------------
// 6. The baseline, and what has moved since
// ---------------------------------------------------------------------------

const APPROVED_LINES = LINES.map((l) => ({ ...l }));
const BASELINE = budgetBaseline({ kpis: KPIS, general: GENERAL, lines: APPROVED_LINES });
APPROVED_LINES[6].rate = 999_999; // the live lines go on being edited after the reopen

check("the baseline freezes the approved lines, not live ones", BASELINE.lines[6].rate, 625_000);
check("the baseline carries the approved summary", BASELINE.kpis.profit, 807_779.36);

/* After the reopen: CMT up 25,000 (a customer quantity change). */
const NOW_TOTALS = budgetTotals(
  LINES.map((l) => (l.source === "cmt" ? { ...l, rate: 650_000 } : l)),
  ORDERS,
);
const NOW = generalSummary(NOW_TOTALS, 5321);
const DIFF = compareToBaseline(roundTrip(BASELINE), NOW);
const at = (key: string) => DIFF.find((r) => r.key === key)!;

check(
  "every category, then the bottom line",
  DIFF.map((r) => r.key),
  ["yarn", "fabric", "accessories", "processing", "cmt", "other", "total", "sales", "income", "profit", "margin", "cost_per_piece"],
);
check("CMT moved by +25,000", [at("cmt").baseline, at("cmt").current, at("cmt").variance], [625_000, 650_000, 25_000]);
check("an unchanged category varies by 0", at("yarn").variance, 0);
check("total expenses +25,000", at("total").variance, 25_000);
check("profit −25,000", at("profit").variance, -25_000);
check("margin is a percentage row", [at("margin").kind, at("margin").variance], ["percent", -0.64]);
check("cost per piece moved by 25,000 / 5,321", at("cost_per_piece").variance, 4.7);

const NOW_BAD = generalSummary(BAD_TOTALS, 5321);
check(
  "a refused CURRENT figure gives a refused variance, and says which side",
  refusalOf(compareToBaseline(BASELINE, NOW_BAD).find((r) => r.key === "sales")!.variance),
  "Current figure unknown — SC-2: two prices for one style",
);
refute(
  "…never the whole baseline shown as the change",
  compareToBaseline(BASELINE, NOW_BAD).find((r) => r.key === "sales")!.variance,
  -GROSS,
);
check(
  "a refused BASELINE figure says so",
  refusalOf(
    compareToBaseline(budgetBaseline({ kpis: BAD, general: NOW_BAD, lines: [] }), NOW).find((r) => r.key === "profit")!
      .variance,
  ),
  "Approved figure unknown — SC-2: two prices for one style",
);
check(
  "a baseline missing its figures reads as not recorded",
  refusalOf(compareToBaseline({ general: {} as never }, NOW)[0].variance),
  "Approved figure unknown — Not recorded",
);

/* A BASELINE FROZEN UNDER THE OLD GROUPING (before 2026-09-24: the fabric
   steps under Processing, no `grouping` marker). Nothing moved, so nothing
   may vary — the 3,50,000 of fabric process is regrouped from its lines. */
const OLD_GENERAL = {
  ...GENERAL,
  grouping: undefined,
  rows: GENERAL.rows.map((r) =>
    r.key === "fabric"
      ? { ...r, amount: (r.amount as number) - 350_000 }
      : r.key === "processing"
        ? { ...r, amount: (r.amount as number) + 350_000 }
        : r,
  ),
};
const OLD_DIFF = compareToBaseline(
  roundTrip(budgetBaseline({ kpis: KPIS, general: OLD_GENERAL, lines: LINES })),
  GENERAL,
);
check(
  "an old-grouping baseline is regrouped: Fabric and Processing vary by 0",
  ["fabric", "processing"].map((k) => OLD_DIFF.find((r) => r.key === k)!.variance),
  [0, 0],
);
check(
  "…and without its lines it refuses rather than invent a variance",
  refusalOf(compareToBaseline({ general: OLD_GENERAL }, GENERAL).find((r) => r.key === "fabric")!.variance),
  "Approved figure unknown — Approved lines not recorded — the fabric steps cannot be regrouped",
);
check(
  "a new-grouping baseline is never regrouped twice",
  compareToBaseline(roundTrip(BASELINE), GENERAL).find((r) => r.key === "fabric")!.variance,
  0,
);

console.log(failed === 0 ? "\nOK — every budget amendment vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
