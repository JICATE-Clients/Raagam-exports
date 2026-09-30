/**
 * Vectors for `lib/orders/budget/breakdown.ts` — the MD approval card's cost
 * buckets, per-piece figures and V0 variance (client 2026-09-29).
 *
 * Every vector sits where two plausible implementations DISAGREE
 * (check-ta-schedule.mts's standard):
 *
 *   1. The fabric's job-work is PROCESS, not Fabric. The first cut regrouped
 *      the General tab, which counts `fabric_process` under Fabric, and drew
 *      budget 3 at 33% Fabric where the client's own grouping gives 26%.
 *   2. V0 is stored only as General categories, so its job-work has to be
 *      split back out of Fabric by `fabricProcessAmountOf` — both sides of a
 *      comparison must group alike or every revision "moves" cost it never moved.
 *   3. Per piece divides by ORDER qty — and each side by ITS OWN qty. A
 *      revision that doubles quantity must not read as every cost head halving.
 *   4. An unknown is never a zero: a refused side refuses the delta.
 *
 * Runs under `tsx` (the `@/lib` aliases). `npm run check:approval-breakdown`.
 */
import {
  breakdownOfBaseline,
  breakdownOfTotals,
  perPiece,
  varianceRows,
  MARGIN_TARGET_PCT,
} from "@/lib/orders/budget/breakdown";
import type { BudgetTotals } from "@/lib/orders/budget/totals";

let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}
const amountOf = (b: ReturnType<typeof breakdownOfTotals>, key: string) =>
  b.buckets.find((x) => x.key === key)?.amount;

// ── 1. Budget 3's real figures (2026-09-29) — the fabric job-work is Process ──
const totals = {
  sales: 1680000,
  income: 0,
  cost: 1260789.81,
  profit: 419210.19,
  profitPct: 24.95,
  unratedNotice: null,
  unpriced: [],
  pending: [],
  costBySource: {
    yarn: 437154.2,
    fabric: 0,
    fabric_process: 118206.54,
    yarn_process: 0,
    material: 401733.07,
    material_process: 0,
    garment_process: 131925,
    cmt: 105540,
    expense: 66231,
    income: 0,
  },
} as unknown as BudgetTotals;
const now = breakdownOfTotals(totals);
eq("1a Fabric = yarn + fabric only", amountOf(now, "fabric"), 437154.2);
eq("1b Process carries the fabric job-work", amountOf(now, "process"), 250131.54);
eq("1c CMT & Overheads = CMT + other expense", amountOf(now, "cmt_overheads"), 171771);
eq("1d Fabric share 26.02% (not 33.06%)", now.buckets[0].pct, 26.02);

// ── 2. V0 from General categories: its job-work moves out of Fabric ──
// A grouping-2 baseline counts fabric_process INSIDE `fabric`.
const v0 = breakdownOfBaseline(
  {
    yarn: 400000,
    fabric: 100000, // of which 100000 is job-work
    processing: 120000,
    accessories: 380000,
    cmt: 100000,
    other: 60000,
    sales: 1600000,
    income: 0,
    profit: 440000,
    margin: 27.5,
  },
  100000,
);
eq("2a V0 Fabric loses its job-work", amountOf(v0, "fabric"), 400000);
eq("2b V0 Process gains it", amountOf(v0, "process"), 220000);
eq(
  "2c V0 job-work unknown → Fabric AND Process refuse, never guess",
  [amountOf(breakdownOfBaseline({ yarn: 1, fabric: 1, processing: 1, sales: 10 }, { refused: "x" }), "fabric"),
   amountOf(breakdownOfBaseline({ yarn: 1, fabric: 1, processing: 1, sales: 10 }, { refused: "x" }), "process")],
  [{ refused: "x" }, { refused: "x" }],
);

// ── 3. Per piece: ORDER qty, each side its own ──
eq("3a per piece", perPiece(437154.2, 5000), 87.43);
eq("3b no quantity is not ₹0/pc", perPiece(1000, 0), { refused: "No order quantity" });
const doubled = varianceRows(v0, now, 2500, 5000);
const fabricRow = doubled.find((r) => r.key === "fabric")!;
eq("3c V0 per piece uses V0's qty", fabricRow.v0, 160);
eq("3d now per piece uses now's qty", fabricRow.now, 87.43);
eq("3e delta is per piece, not per order", fabricRow.delta, -72.57);

// ── 4. Unknowns refuse; margin is compared in points ──
const unknownQty = varianceRows(v0, now, null, 5000);
eq("4a V0 qty unknown → delta refuses", unknownQty[0].delta, { refused: "No order quantity" });
const margin = doubled.find((r) => r.key === "margin")!;
eq("4b margin delta in points", margin.delta, -2.55);
eq("4c the 15% line is the declared constant", MARGIN_TARGET_PCT, 15);

if (failed) {
  console.error(`\ncheck:approval-breakdown — ${failed} failed`);
  process.exit(1);
}
console.log("\ncheck:approval-breakdown — all vectors hold");
