// Verification vectors for lib/orders/amendments/qty-balance.ts — the quantity
// double lock the Details overlay, the Save button and the server action all read.
//
//     node --experimental-strip-types scripts/check-qty-balance.mts
//
// WHY THIS FILE EXISTS. Both rules were enforced only in the browser until
// 2026-08-31, and a dead Save cannot refuse a stale client or a direct post. The
// arithmetic now lives in one module so the two enforcers cannot drift; these
// vectors are what make "cannot drift" checkable rather than asserted.
//
// The cases are the shapes this screen actually produces — a solid pack, an
// assorted pack with inners, the 0473 boxes row, and the two abstentions —
// not invented arithmetic.

import {
  assortTotal,
  assortBalance,
  assortBalanceMessage,
  crossTabPoQtyMessage,
  totalQuantityPoQty,
  type BalanceRow,
} from "../lib/orders/amendments/qty-balance.ts";

let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`ok    ${label}`);
  else {
    failed++;
    console.error(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const line = (qtys: number[], cartons = 0, innersPer = 0, pack = false) => ({
  is_pack_row: pack,
  no_of_cartons: cartons,
  inners_per_carton: innersPer,
  sizes: qtys.map((q) => ({ qty: q })),
});

// ---------------------------------------------------------------------------
// Solid: the size cells ARE the pieces.
// ---------------------------------------------------------------------------
const solid: BalanceRow = { po_qty: 30, assort_lines: [line([10, 20])] };
eq("solid sums the size cells", assortTotal(solid, "solid"), 30);
eq("solid in balance", assortBalance(solid, "solid"), 0);
eq("balanced says nothing", assortBalanceMessage(solid, "solid", "PARIS"), null);

// ---------------------------------------------------------------------------
// Assorted: cartons x (inners when the ratio is per inner) x ratio.
// ---------------------------------------------------------------------------
const master: BalanceRow = {
  po_qty: 100,
  ratio_for: "master",
  assort_lines: [line([2, 3], 20, 7)],
};
eq("master ignores inners — 20 x 5", assortTotal(master, "assort"), 100);

const inner: BalanceRow = {
  po_qty: 700,
  ratio_for: "inner",
  assort_lines: [line([2, 3], 20, 7)],
};
eq("inner multiplies by inners — 20 x 7 x 5", assortTotal(inner, "assort"), 700);

// A blank inners multiplier means ONE, never NONE — `|| 0` here would zero the
// line and report the destination short by exactly what it ships.
const blankInners: BalanceRow = {
  po_qty: 100,
  ratio_for: "inner",
  assort_lines: [line([2, 3], 20, 0)],
};
eq("blank inners counts as 1", assortTotal(blankInners, "assort"), 100);

// ---------------------------------------------------------------------------
// 0473 — the boxes row never joins a piece total.
// ---------------------------------------------------------------------------
const withPackRow: BalanceRow = {
  po_qty: 30,
  assort_lines: [line([10, 20]), line([5, 5], 0, 0, true)],
};
eq("the pack row is excluded", assortTotal(withPackRow, "solid"), 30);
eq("...so the destination still balances", assortBalance(withPackRow, "solid"), 0);

// ---------------------------------------------------------------------------
// The two abstentions — an unanswered section is not a disagreement.
// ---------------------------------------------------------------------------
eq("an empty breakup abstains", assortBalance({ po_qty: 500, assort_lines: [] }, "solid"), null);
eq(
  "a breakup of zero abstains",
  assortBalance({ po_qty: 500, assort_lines: [line([0, 0])] }, "solid"),
  null,
);
eq("no quantity rows abstains", crossTabPoQtyMessage(500, 0), null);

// ---------------------------------------------------------------------------
// The refusals, and both figures in the sentence.
// ---------------------------------------------------------------------------
const short: BalanceRow = { po_qty: 500, assort_lines: [line([460])] };
eq("short reports the gap", assortBalance(short, "solid"), 40);
eq(
  "short names the destination and the target",
  assortBalanceMessage(short, "solid", "PARIS"),
  "PARIS: the breakup is 40 short of the order qty (500). Open Details and make them match.",
);
eq(
  "a nameless destination still reads",
  assortBalanceMessage(short, "solid", "   "),
  "this destination: the breakup is 40 short of the order qty (500). Open Details and make them match.",
);
const over: BalanceRow = { po_qty: 500, assort_lines: [line([540])] };
eq("over reports the excess", assortBalance(over, "solid"), -40);

eq("cross-tab is silent when equal", crossTabPoQtyMessage(500, 500), null);
eq(
  "cross-tab names both figures — destinations short",
  crossTabPoQtyMessage(500, 460),
  "Style PO Qty 500 does not match Quantities PO Qty 460 — the destinations are 40 short of the order.",
);
eq(
  "cross-tab names both figures — destinations over",
  crossTabPoQtyMessage(460, 500),
  "Style PO Qty 460 does not match Quantities PO Qty 500 — the destinations are 40 over the order.",
);
// Styles at zero against real destinations IS a disagreement — pieces shipped
// that the contract does not account for.
eq("zero styles against real destinations reports", crossTabPoQtyMessage(0, 500) !== null, true);

// ---------------------------------------------------------------------------
// Strings and numbers must give the same answer — the screen holds every figure
// as a string, the server as a number, and this is the seam where a `""` -> 0
// or a NaN difference would hide.
// ---------------------------------------------------------------------------
const asStrings: BalanceRow = {
  po_qty: "700",
  ratio_for: "inner",
  assort_lines: [
    { is_pack_row: false, no_of_cartons: "20", inners_per_carton: "7", sizes: [{ qty: "2" }, { qty: "3" }] },
  ],
};
eq("string rows equal number rows", assortTotal(asStrings, "assort"), assortTotal(inner, "assort"));
eq(
  "a blank string is zero, not NaN",
  assortTotal({ po_qty: "", assort_lines: [line([1]), { sizes: [{ qty: "" }] }] }, "solid"),
  1,
);
eq("totalQuantityPoQty sums mixed shapes", totalQuantityPoQty([{ po_qty: "10" }, { po_qty: 5 }]), 15);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall qty-balance vectors pass");
process.exit(failed ? 1 : 0);
