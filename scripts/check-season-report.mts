/**
 * Vectors for `lib/orders/season-report/derive.ts` — Orders ▸ Season Report.
 *
 * Every rule below is one a plausible implementation gets wrong in a way that
 * still looks fine on screen:
 *
 *  1. SEASON AND YEAR ARE A PAIR. A date range would put an order keyed in early
 *     2027 for Q4 2026 under the wrong season (the client's own example).
 *  2. A SEASON MATCHES CASE-INSENSITIVELY — Order Info stores "Summer", the
 *     styles master "SUMMER".
 *  3. AN ORDER WITH NO YEAR NEVER MATCHES A CHOSEN YEAR. It is counted, not
 *     silently included and not silently dropped.
 *  4. PART-SHIPPED IS NOT SHIPPED. Unticking "Shipped Orders" must keep an order
 *     that still has a balance — that is the whole use of the toggle.
 *  5. THE FABRIC BALANCE IS NULL, NEVER 0, WHEN IT CANNOT BE ANSWERED.
 */
import {
  byCustomer,
  byDeliveryMonth,
  byStatus,
  daysUntil,
  fabricBalance,
  fulfilmentOf,
  inSeason,
  nextDelivery,
  normSeason,
  ringSegments,
  seasonLabel,
  totalsOf,
  yearWindow,
} from "../lib/orders/season-report/derive.ts";
import type { Fulfilment, SeasonOrder } from "../lib/orders/season-report/types.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) console.log(`ok    ${label}`);
  else {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}
function refute(label: string, actual: unknown, forbidden: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else console.log(`ok    ${label}`);
}

function order(p: Partial<SeasonOrder> & { id: string }): SeasonOrder {
  return {
    salesOrderId: p.id,
    amendmentId: `doc-${p.id}`,
    reNo: p.reNo ?? `RE-${p.id}`,
    customer: p.customer ?? "ACME",
    poNo: null,
    merchandiser: null,
    season: p.season ?? "Summer",
    year: p.year === undefined ? 2026 : p.year,
    deliveryDate: p.deliveryDate === undefined ? "2026-09-15" : p.deliveryDate,
    qty: p.qty ?? 1000,
    shippedQty: p.shippedQty ?? 0,
    balanceQty: p.balanceQty ?? Math.max(0, (p.qty ?? 1000) - (p.shippedQty ?? 0)),
    fulfilment: p.fulfilment ?? "pending",
    riskLevel: p.riskLevel ?? "on_track",
    riskLabel: "",
    daysLate: 0,
    cause: null,
    styles: [],
    thumbnail: null,
    fabric: { requiredKg: null, receivedKg: null, balanceKg: null, note: null },
  };
}

console.log("\n--- 1-3. season and year ---");
check("a season matches regardless of case", inSeason({ season: "Summer", year: 2026 }, "SUMMER", 2026), true);
check("a different season does not match", inSeason({ season: "Winter", year: 2026 }, "Summer", 2026), false);
check("the year is part of the key: Summer 2027 is not Summer 2026", inSeason({ season: "Summer", year: 2027 }, "Summer", 2026), false);
check("year null = any year", inSeason({ season: "Summer", year: 2031 }, "Summer", null), true);
check("season '' = any season", inSeason({ season: "Winter", year: 2026 }, "", 2026), true);
check("an order with NO year never matches a chosen year", inSeason({ season: "Summer", year: null }, "Summer", 2026), false);
check("...but does match when the year is left open", inSeason({ season: "Summer", year: null }, "Summer", null), true);
check("trim + upper-case on both sides", normSeason("  summer "), "SUMMER");
check("label: season + year", seasonLabel("SUMMER", 2026), "Summer 2026");
check("label: season alone says all years", seasonLabel("winter", null), "Winter · all years");
check("label: nothing chosen", seasonLabel("", null), "All seasons");

console.log("\n--- 4. fulfilment and the status toggles ---");
const f = (o: Parameters<typeof fulfilmentOf>[0]) => fulfilmentOf(o);
check("confirmed, nothing started = pending", f({ orderStatus: "confirmed", qty: 100, shippedQty: 0, producing: false }), "pending");
check("production entries = in production", f({ orderStatus: "confirmed", qty: 100, shippedQty: 0, producing: true }), "in_production");
check("RE status in_production = in production", f({ orderStatus: "in_production", qty: 100, shippedQty: 0, producing: false }), "in_production");
check("some shipped = part shipped", f({ orderStatus: "in_production", qty: 100, shippedQty: 40, producing: true }), "partial");
check("all shipped = shipped", f({ orderStatus: "in_production", qty: 100, shippedQty: 100, producing: true }), "shipped");
check("over-shipped is still shipped", f({ orderStatus: "confirmed", qty: 100, shippedQty: 104, producing: false }), "shipped");
check("a closed RE is shipped even short", f({ orderStatus: "closed", qty: 100, shippedQty: 60, producing: false }), "shipped");
check("a zero-quantity order is never 'shipped' by arithmetic", f({ orderStatus: "confirmed", qty: 0, shippedQty: 0, producing: false }), "pending");

const mix: SeasonOrder[] = [
  order({ id: "a", fulfilment: "shipped", qty: 500, shippedQty: 500 }),
  order({ id: "b", fulfilment: "partial", qty: 1000, shippedQty: 400 }),
  order({ id: "c", fulfilment: "in_production", qty: 800 }),
  order({ id: "d", fulfilment: "pending", qty: 200 }),
];
const ids = (xs: SeasonOrder[]) => xs.map((o) => o.salesOrderId);
check("both ticked shows all four", ids(byStatus(mix, { shipped: true, pending: true })), ["a", "b", "c", "d"]);
check("UNTICK Shipped: only the open balances remain", ids(byStatus(mix, { shipped: false, pending: true })), ["b", "c", "d"]);
refute("...and a part-shipped order is NOT treated as shipped", ids(byStatus(mix, { shipped: false, pending: true })), ["c", "d"]);
check("Shipped alone shows only the finished ones", ids(byStatus(mix, { shipped: true, pending: false })), ["a"]);
check("both unticked shows nothing", ids(byStatus(mix, { shipped: false, pending: false })), []);

console.log("\n--- totals, ring, buyers, months ---");
const t = totalsOf(mix);
check("pieces add up", t.qty, 2500);
check("shipped pieces", t.shippedQty, 900);
check("balance pieces", t.balanceQty, 1600);
check("shipped share to one decimal", t.shippedPct, 36);
check("customers are distinct", t.customers, 1);
check("totals of nothing are zeros, not NaN", totalsOf([]).shippedPct, 0);
check("an over-shipment does not push the shipped share past 100", totalsOf([order({ id: "x", qty: 100, shippedQty: 130, fulfilment: "shipped" })]).shippedPct, 100);
check(
  "ring: pieces per state in fixed order",
  ringSegments(mix).map((s) => [s.key, s.qty] as [Fulfilment, number]),
  [["shipped", 500], ["partial", 1000], ["in_production", 800], ["pending", 200]],
);
check(
  "buyers ranked by pieces",
  byCustomer([order({ id: "1", customer: "B", qty: 100 }), order({ id: "2", customer: "A", qty: 300 }), order({ id: "3", customer: "B", qty: 250 })]).map((r) => [r.customer, r.qty]),
  [["B", 350], ["A", 300]],
);
check(
  "delivery months oldest first, undated last",
  byDeliveryMonth([
    order({ id: "1", deliveryDate: "2026-11-02" }),
    order({ id: "2", deliveryDate: null }),
    order({ id: "3", deliveryDate: "2026-09-30" }),
  ]).map((m) => m.month),
  ["2026-09", "2026-11", ""],
);

console.log("\n--- next delivery ---");
const nd = nextDelivery(
  [
    order({ id: "late", deliveryDate: "2026-09-01", fulfilment: "pending" }),
    order({ id: "soon", deliveryDate: "2026-10-12", fulfilment: "in_production" }),
    order({ id: "far", deliveryDate: "2026-12-01", fulfilment: "pending" }),
    order({ id: "done", deliveryDate: "2026-10-10", fulfilment: "shipped" }),
  ],
  "2026-10-09",
);
check("the next delivery is the soonest unshipped one on or after today", nd?.order.salesOrderId, "soon");
check("...counted in days", nd?.days, 3);
check(
  "with only overdue orders open, the oldest overdue is named (negative days)",
  nextDelivery([order({ id: "x", deliveryDate: "2026-10-01" })], "2026-10-09")?.days,
  -8,
);
check("nothing open = no next delivery", nextDelivery([order({ id: "x", fulfilment: "shipped" })], "2026-10-09"), null);

console.log("\n--- 5. fabric balance ---");
const noBom = fabricBalance({ requiredKg: null, receivedKg: 0, otherUnitLines: 0, hasFabricLines: false, refusedRows: 0 });
check("no Fabric BOM: balance is NULL with a reason", [noBom.balanceKg, noBom.note], [null, "No Fabric BOM yet"]);
refute("...never 0", noBom.balanceKg, 0);
const bought = fabricBalance({ requiredKg: 1200, receivedKg: 450, otherUnitLines: 0, hasFabricLines: true, refusedRows: 0 });
check("required less received", bought.balanceKg, 750);
check("over-receipt floors at 0, not a negative balance", fabricBalance({ requiredKg: 100, receivedKg: 140, otherUnitLines: 0, hasFabricLines: true, refusedRows: 0 }).balanceKg, 0);
const mixedUnits = fabricBalance({ requiredKg: 1200, receivedKg: 450, otherUnitLines: 2, hasFabricLines: true, refusedRows: 0 });
check("fabric bought in another unit: receipt not counted, balance NULL", [mixedUnits.receivedKg, mixedUnits.balanceKg], [null, null]);
check("nothing purchased yet: the whole requirement is the balance, said plainly", (({ balanceKg, note }) => [balanceKg, note])(fabricBalance({ requiredKg: 800, receivedKg: 0, otherUnitLines: 0, hasFabricLines: false, refusedRows: 0 })), [800, "No fabric purchased yet"]);
check("unworked requirement rows are named", fabricBalance({ requiredKg: 800, receivedKg: 0, otherUnitLines: 0, hasFabricLines: true, refusedRows: 3 }).note, "3 requirement rows not worked out yet");

console.log("\n--- year window ---");
check("always offers last year to two ahead, plus what orders carry", yearWindow(2026, [2024]), [2024, 2025, 2026, 2027, 2028]);

console.log(failed === 0 ? "\nOK — every season-report vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
