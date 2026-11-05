/**
 * check:analytics — the Analytics boards' arithmetic (Phase 1, user 2026-11-05).
 *
 * Pins the four rules `lib/analytics/compute.ts` states in its header, each of which
 * would still render a plausible-looking number if broken:
 *   1. an unpriced order is counted, never valued at zero
 *   2. margin is weighted by income
 *   3. a PO is late past its expected date with qty to come, or received after it;
 *      a PO with no expected date is left out of the rate
 *   4. stock without value access counts lots
 * plus the FY period (April–March) and its comparison.
 *
 * Verified by being made to FAIL first: with `weightedMargin` swapped for a plain
 * average of `marginPct`, vector 2 fails (19.0 ≠ 22.9).
 */
import { parsePeriod, inRange, fyStartYear } from "../lib/analytics/period.ts";
import { deliveryBoard, onLeaveToday, openTickets, samplesBoard, stepState, ordersBoard, poTiming, profitBoard, purchaseBoard, stockBoard, weightedMargin, topWithOthers, type BudgetIn, type EnquiryIn, type LotIn, type OrderIn, type PoIn, type StepIn } from "../lib/analytics/compute.ts";

let failed = 0;
function ok(cond: boolean, name: string, detail = "") {
  if (cond) console.log(`ok    ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 0.05;

// --- period -----------------------------------------------------------------
const fy = parsePeriod(undefined, "2026-11-05");
ok(fy.from === "2026-04-01" && fy.to === "2027-03-31" && fy.label === "FY 26-27", "this FY is April to March", JSON.stringify(fy));
ok(fy.prev?.from === "2025-04-01" && fy.prev?.label === "FY 25-26", "compared with the FY before");
ok(fyStartYear("2027-02-10") === 2026 && fyStartYear("2026-04-01") === 2026 && fyStartYear("2026-03-31") === 2025, "FY boundary is 1 April");
ok(parsePeriod("lfy", "2026-11-05").label === "FY 25-26", "last FY");
const all = parsePeriod("all", "2026-11-05");
ok(all.prev === null && inRange(null, all) && inRange("2019-01-01", all), "all time has no comparison and keeps undated rows");
ok(!inRange(null, fy), "an undated row is outside a FY");
ok(parsePeriod("junk", "2026-11-05").key === "fy", "an unknown word falls back to this FY");

// --- 1. orders --------------------------------------------------------------
const o = (id: string, value: number | null, qty: number, buyer = "A", delivery: string | null = "2026-11-20", date = "2026-06-01"): OrderIn => ({
  id, reNo: id, buyerId: buyer, buyer, merchandiser: "M", season: "S", orderDate: date, deliveryDate: delivery, valueInr: value, qty,
});
const ob = ordersBoard([o("1", 100, 10), o("2", null, 5), o("3", 50, 1, "B", "2026-10-01"), o("4", 999, 9, "A", null, "2025-06-01")], fy, "2026-11-05");
ok(ob.totals.value === 150 && ob.totals.unpriced === 1 && ob.totals.orders === 3 && ob.totals.pieces === 16, "1. unpriced order counted, not valued", JSON.stringify(ob.totals));
ok(ob.prev?.value === 999, "1. last FY's order lands in the comparison only");
ok(ob.shippingSoon.length === 2 && ob.overdue === 1, "1. shipping in 30 days vs past delivery date");
ok(ordersBoard([o("1", 100, 10), o("3", 50, 1, "B")], fy, "2026-11-05", "B").totals.value === 50, "1. buyer filter narrows the board");
ok(topWithOthers([1, 2, 3, 4, 5, 6, 7].map((v) => ({ key: `${v}`, label: `${v}`, value: v })), 4).at(-1)?.label === "Others (4)", "1. the tail folds into Others (n)");

// --- 2. margin --------------------------------------------------------------
const bud = (id: string, income: number | null, profit: number | null, status: "approved" | "submitted" = "approved"): BudgetIn => ({
  id, code: id, status, budgetDate: "2026-07-01", reNos: [id], buyers: ["A"], income, profit, marginPct: income && profit != null ? (profit / income) * 100 : null,
});
const rows = [bud("a", 1600000, 576000), bud("b", 1000000, 20000)];
ok(near(weightedMargin(rows), 22.9), "2. margin is Σprofit ÷ Σincome, not an average of %", String(weightedMargin(rows)));
const pb = profitBoard([...rows, bud("c", null, null, "submitted")], fy);
ok(pb.low.length === 1 && pb.low[0].id === "b" && pb.unknown === 1 && pb.withMd === 1, "2. below 5%, unknown and with-MD counted apart");

// --- 3. PO timing -----------------------------------------------------------
const po = (p: Partial<PoIn>): PoIn => ({
  id: "p", placed: true, status: "approved", code: "p", vendor: "V", orderDate: "2026-10-01", expectedDate: "2026-10-20", value: 100, receivedValue: 0, openQty: 0,
  overBudgetReason: null, byClass: new Map(), lastGrn: null, receivedQty: 0, rejectedQty: 0, ...p,
});
const t = "2026-11-05";
ok(poTiming(po({ openQty: 5 }), t).state === "late" && poTiming(po({ openQty: 5 }), t).daysLate === 16, "3. open past expected is late, days counted to today");
ok(poTiming(po({ openQty: 5, expectedDate: "2026-12-01" }), t).state === "open", "3. open before expected is neither");
ok(poTiming(po({ lastGrn: "2026-10-25" }), t).daysLate === 5, "3. received after expected is late by the receipt date");
ok(poTiming(po({ lastGrn: "2026-10-18" }), t).state === "on_time", "3. received by expected is on time");
const ub = purchaseBoard([po({ id: "1", lastGrn: "2026-10-18", receivedValue: 100 }), po({ id: "2", expectedDate: null, openQty: 3 }), po({ id: "3", openQty: 1, overBudgetReason: "rate" })], fy, t);
ok(ub.decided === 2 && near(ub.onTimePct, 50), "3. an undated PO is left out of the on-time rate", JSON.stringify({ d: ub.decided, p: ub.onTimePct }));
ok(ub.attention[0]?.why === "over_budget", "3. over budget is listed first");
const ub2 = purchaseBoard([po({ id: "w", placed: false, status: "pending_approval", value: 500 }), po({ id: "r", receivedValue: 100, lastGrn: "2026-10-18" }), po({ id: "p", receivedValue: 40, openQty: 2 })], fy, t);
ok(ub2.value === 200 && ub2.pipeline.map((x) => x.count).join() === "1,0,1,1,0", "3. a PO waiting approval is in the pipeline, not in spend", JSON.stringify({ v: ub2.value, p: ub2.pipeline.map((x) => x.count) }));

// --- 4. stock ---------------------------------------------------------------
const lot = (band: LotIn["band"], value?: number, g: LotIn["group_kind"] = "re"): LotIn => ({
  key: Math.random().toString(), item: "I", item_class: "Yarn", store: "S", bin: "B", lot: "L", age_days: band === "90+" ? 120 : 10, band, group_kind: g, order_no: "RE", qty: 50, uom: "KG", value,
});
const lots = [lot("0-30", 300), lot("90+", 100, "general")];
ok(stockBoard(lots, true).total === 400 && near(stockBoard(lots, true).oldPct, 25), "4. with value, money is summed");
ok(stockBoard(lots, false).total === 2 && stockBoard(lots, false).general === 1, "4. without value, lots are counted");

// --- 5. delivery steps ------------------------------------------------------
const st = (target: string, actual: string | null, delivery = "2026-11-20"): StepIn => ({
  orderId: "o", reNo: "RE", buyer: "A", deliveryDate: delivery, source: "T&A", label: "Fabric", target, actual, owner: "M",
});
ok(stepState(st("2026-10-01", "2026-10-04"), t).state === "done_late" && stepState(st("2026-10-01", "2026-10-04"), t).daysLate === 3, "5. done after target is late by the done date");
ok(stepState(st("2026-12-01", null), t).state === "upcoming", "5. not due yet is neither");
const db = deliveryBoard([st("2026-10-01", "2026-10-01"), st("2026-10-01", null), st("2026-12-01", null)], fy, t);
ok(db.decided === 2 && near(db.onTimePct, 50) && db.lateNow === 1 && db.atRisk === 1, "5. upcoming steps stay out of the rate; late + ships soon = at risk", JSON.stringify({ d: db.decided, l: db.lateNow, r: db.atRisk }));

// --- 6. samples funnel ------------------------------------------------------
const enq = (id: string, status: "draft" | "submitted" | "approved" | "rejected" | null, order = false): EnquiryIn => ({
  id, code: id, title: id, buyer: "A", merchandiser: "M", received: "2026-06-01", becameOrder: order,
  costing: status ? { id, status, firstAt: "2026-06-05", submittedAt: "2026-06-06", marginPct: null } : null,
});
const sm = samplesBoard([enq("1", null), enq("2", "draft"), enq("3", "submitted"), enq("4", "approved", true)], fy, t);
const f = sm.funnel.map((x) => x.value);
ok(f.join() === "4,3,2,1,1" && f.every((v, i) => i === 0 || v <= f[i - 1]), "6. each funnel step counts those that got at least that far", f.join());
ok(near(sm.avgDaysToCosting, 4) && sm.waiting.length === 1, "6. days to first costing; submitted = waiting");

// --- 7. people --------------------------------------------------------------
const tk = openTickets(
  [
    { id: "1", refNo: "1", kind: "broken", title: "", status: "open", createdAt: "2026-10-01T00:00:00Z", late: true },
    { id: "2", refNo: "2", kind: "broken", title: "", status: "closed", createdAt: "2026-10-01T00:00:00Z", late: true },
    { id: "3", refNo: "3", kind: "service", title: "", status: "resolved", createdAt: "2026-11-04T00:00:00Z", late: false },
  ],
  t,
);
ok(tk.open === 1 && tk.late === 1 && tk.byKind[0].parts[2] === 1, "7. closed and resolved tickets are not open; age bands");
ok(onLeaveToday([{ status: "approved", start: "2026-11-04", end: "2026-11-06" }, { status: "pending", start: "2026-11-05", end: "2026-11-05" }], t) === 1, "7. only approved leave covering today counts");

if (failed) {
  console.log(`\ncheck:analytics — ${failed} FAILED`);
  process.exit(1);
}
console.log("\ncheck:analytics — all assertions passed");
