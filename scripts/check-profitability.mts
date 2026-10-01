/**
 * Vectors for `lib/orders/profitability/types.ts` — Order Profitability's
 * budget-vs-actual comparison (doc/order/digitalisation-plan.md §3).
 *
 * ## THE THREE THAT WOULD SURVIVE A CARELESS REWRITE
 *
 * 1. **"No documents yet" is not zero.** Every actuals table was empty on
 *    2026-10-01. A rewrite that defaults a missing bucket to 0 prints "−100%,
 *    saved the whole fabric cost" — believable and wrong.
 * 2. **Actual profit needs a sale.** Before anything ships, profit is not
 *    "minus every cost so far"; it is not known yet.
 * 3. **The flag points the way that costs money.** A cost is flagged OVER its
 *    budget by more than 5 %; sales and profit are flagged UNDER. A shared
 *    `Math.abs` would flag a saving as a problem.
 *
 * Run: npx tsx scripts/check-profitability.mts
 */

import {
  compareProfitability,
  purchaseBucketOf,
  OVER_BUDGET_PCT,
  type ProfitInput,
} from "../lib/orders/profitability/types";

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

const budget = (): ProfitInput["budget"] => ({
  buckets: { fabric: 100_000, process: 40_000, trims: 20_000, cmt_overheads: 30_000 },
  sales: 250_000,
  income: 0,
  profit: 60_000,
});

// 1. Nothing recorded at all.
{
  const s = compareProfitability({
    budget: budget(),
    actual: { buckets: { fabric: null, process: null, trims: null, cmt_overheads: null }, sales: null, income: null },
  });
  check("no documents → actual is null, not 0", s.costs.every((c) => c.actual === null), s.costs);
  check("no documents → no difference", s.costs.every((c) => c.diff === null));
  check("no documents → nothing flagged", s.costs.every((c) => !c.flagged));
  check("nothing shipped → actual profit null", s.profit.actual === null);
  check("nothing shipped → margin refuses", typeof s.actualProfitPct === "object");
  check("missing lists all four", s.missing.length === 4, s.missing);
}

// 2. A cost 6 % over is flagged; 5 % over is not (strictly MORE than the limit).
{
  const s = compareProfitability({
    budget: budget(),
    actual: {
      buckets: {
        fabric: { committed: 110_000, actual: 106_000, docs: 2 },
        process: { committed: 40_000, actual: 42_000, docs: 1 },
        trims: { committed: 15_000, actual: 15_000, docs: 1 },
        cmt_overheads: { committed: null, actual: 30_000, docs: 1 },
      },
      sales: { amount: 250_000, qty: 5_000, docs: 1 },
      income: null,
    },
  });
  const by = Object.fromEntries(s.costs.map((c) => [c.key, c]));
  check("6% over → flagged", by.fabric.flagged === true && by.fabric.diffPct === 6, by.fabric);
  check("exactly 5% over → not flagged", by.process.flagged === false && by.process.diffPct === OVER_BUDGET_PCT, by.process);
  check("25% UNDER on a cost → not flagged (a saving)", by.trims.flagged === false && by.trims.diffPct === -25, by.trims);
  check("actual profit = sales − Σ actual cost", s.profit.actual === 250_000 - (106_000 + 42_000 + 15_000 + 30_000), s.profit);
  check("profit diff = actual − budget", s.profit.diff === 57_000 - 60_000);
  check("profit 5% short → not flagged", s.profit.flagged === false, s.profit);
  check("committed carried through", by.fabric.committed === 110_000);
  check("nothing missing", s.missing.length === 0);
}

// 3. Sales short by more than 5 % is flagged; profit short by more than 5 % is flagged.
{
  const s = compareProfitability({
    budget: budget(),
    actual: {
      buckets: {
        fabric: { committed: 100_000, actual: 100_000, docs: 1 },
        process: { committed: 40_000, actual: 40_000, docs: 1 },
        trims: { committed: 20_000, actual: 20_000, docs: 1 },
        cmt_overheads: { committed: null, actual: 30_000, docs: 1 },
      },
      sales: { amount: 200_000, qty: 4_000, docs: 1 },
      income: 1_000,
    },
  });
  check("sales 20% short → flagged", s.sales.flagged === true && s.sales.diffPct === -20, s.sales);
  check("income counts into actual profit", s.profit.actual === 200_000 + 1_000 - 190_000, s.profit);
  check("profit far short → flagged", s.profit.flagged === true, s.profit);
}

// 4. A refused budget profit is carried, never turned into a number.
{
  const b = budget();
  b.profit = { refused: "Suppressed — 2 rates missing" };
  const s = compareProfitability({
    budget: b,
    actual: {
      buckets: { fabric: { committed: 1, actual: 1, docs: 1 }, process: null, trims: null, cmt_overheads: null },
      sales: { amount: 10, qty: 1, docs: 1 },
      income: null,
    },
  });
  check("refused budget profit → no difference", s.profit.diff === null && typeof s.profit.budget === "object");
  check("provisional profit names missing heads", s.missing.join(",") === "Process,Trims & Accessories,CMT & Overheads", s.missing);
}

// 5. Item class → bucket.
check("YARN → fabric", purchaseBucketOf("YARN") === "fabric");
check("fabric (any case) → fabric", purchaseBucketOf(" fabric ") === "fabric");
check("SEW → trims", purchaseBucketOf("SEW") === "trims");
check("PACK → trims", purchaseBucketOf("PACK") === "trims");
check("unknown class → trims", purchaseBucketOf(null) === "trims");

console.log(`check-profitability: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
