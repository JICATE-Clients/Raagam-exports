/**
 * Vectors for `lib/orders/amendments/order-value.ts` — the order's Gross Value
 * and Average Rate.
 *
 * THIS MODULE COMPUTES MONEY, and it has more refusal branches than answering
 * ones, which is deliberate: its header states that a PARTIAL sum is the
 * dangerous failure because "a Gross Value of 21,000 on an order actually worth
 * 36,000 looks exactly like a correct answer, so it gets believed rather than
 * reported". A vector suite that only checked the happy path would let every one
 * of those branches rot into a plausible number.
 *
 * The centrepiece is `weighted, not a flat mean`: it is built so the two answers
 * DIFFER, and asserts the flat mean is not what comes back. A test where 90/10
 * and 50/50 give the same figure proves nothing about weighting at all.
 *
 * ## Why this one runs under `tsx` and its siblings run under bare node
 *
 * Every other `check-*.mts` targets a LEAF module — `rules.ts`,
 * `name-vocabularies.ts`, `module-groups.ts` — whose only imports are types,
 * which type-stripping erases. `order-value.ts` imports `styleKey` at RUNTIME,
 * and `./style-key` has no extension, which Node's ESM resolver refuses
 * (ERR_MODULE_NOT_FOUND). Adding the extension is not available: `tsc` rejects
 * `./style-key.ts` without `allowImportingTsExtensions`, and the app's own build
 * has to resolve that same specifier.
 *
 * The import is not incidental and must not be removed to suit the runner —
 * `style-key.ts` exists as its own file precisely so both sides of the
 * server/client boundary share ONE key rule, and its header argues at length
 * against a second copy. So the runner moves instead of the rule.
 */
import { inrValue, orderValue, styleRate } from "../lib/orders/amendments/order-value.ts";

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

const S = "TSH-001";
const SIZE_S = "11111111-1111-1111-1111-111111111111";
const SIZE_M = "22222222-2222-2222-2222-222222222222";

const style = (po_qty: number, ref = S) => ({ style_ref_no: ref, po_qty });
const price = (
  p: number,
  opts: { type?: string; combo?: string | null; size?: string | null; ref?: string } = {},
) => ({
  style_ref_no: opts.ref ?? S,
  price_type: opts.type ?? "Style-wise",
  combo: opts.combo ?? null,
  size_id: opts.size ?? null,
  price: p,
});
const qty = (
  q: number,
  opts: { combo?: string | null; size?: string | null; ref?: string } = {},
) => ({
  style_ref_no: opts.ref ?? S,
  combo: opts.combo ?? null,
  size_id: opts.size ?? null,
  qty: q,
});

// ---------- Style-wise: one rate is one rate ----------

check(
  "a single style-wise rate values the order",
  orderValue([style(1000)], [price(5)]),
  { grossValue: 5000, avgRate: 5, unresolved: [] },
);

// A simple order must not need the Quantities tab filled in to show its value —
// that tab is optional, and reading it would value a real order at zero.
check(
  "style-wise never consults quantities",
  orderValue([style(1000)], [price(5)], []),
  { grossValue: 5000, avgRate: 5, unresolved: [] },
);

check(
  "the same style listed twice at the same rate is not ambiguous",
  orderValue([style(1000)], [price(5), price(5)]),
  { grossValue: 5000, avgRate: 5, unresolved: [] },
);

check(
  "two different style-wise rates refuse and name the style",
  orderValue([style(1000)], [price(5), price(4)]),
  { grossValue: null, avgRate: null, unresolved: [S] },
);

// 0 is unpriced, not free — the grid opens on a blank row.
check(
  "a zero rate is unpriced, not a free garment",
  orderValue([style(1000)], [price(0)]),
  { grossValue: null, avgRate: null, unresolved: [S] },
);

// ---------- THE ONE THAT PROVES WEIGHTING ----------
//
// 900 white at 5.00 and 100 navy at 10.00.
//   weighted   = (900x5 + 100x10) / 1000 = 5.50   <- correct
//   flat mean  = (5 + 10) / 2             = 7.50   <- what an unweighted rule gives
// The two differ by 36%, which is the entire point of building the vector this
// way: on an even split both rules agree and the test would pass either way.
const SPLIT_PRICES = [
  price(5, { type: "Color-wise", combo: "WHITE" }),
  price(10, { type: "Color-wise", combo: "NAVY" }),
];
const SPLIT_QTYS = [qty(900, { combo: "WHITE" }), qty(100, { combo: "NAVY" })];

check(
  "a colour-wise rate is WEIGHTED by quantity",
  styleRate(S, SPLIT_PRICES, SPLIT_QTYS),
  5.5,
);
check(
  "...and is NOT the flat mean of the two rates",
  styleRate(S, SPLIT_PRICES, SPLIT_QTYS) === 7.5,
  false,
);
check(
  "the weighted rate reaches the order's value",
  orderValue([style(1000)], SPLIT_PRICES, SPLIT_QTYS),
  { grossValue: 5500, avgRate: 5.5, unresolved: [] },
);

// Reversing the split must move the answer — a rule that ignored quantities
// would return 7.50 both times and pass the vector above on its own.
check(
  "flipping the split moves the average the other way",
  styleRate(S, SPLIT_PRICES, [qty(100, { combo: "WHITE" }), qty(900, { combo: "NAVY" })]),
  9.5,
);

// ---------- Colour-wise refusals ----------

check(
  "colour-wise with no quantities at all refuses",
  orderValue([style(1000)], SPLIT_PRICES, []),
  { grossValue: null, avgRate: null, unresolved: [S] },
);

// The subtle one: NAVY is priced but has no quantity behind it. "Ships nothing"
// and "not entered yet" are indistinguishable from here, and weighting it at
// zero would silently drop a real rate out of the average.
check(
  "a priced colour with no quantity poisons the style rather than being dropped",
  orderValue([style(1000)], SPLIT_PRICES, [qty(1000, { combo: "WHITE" })]),
  { grossValue: null, avgRate: null, unresolved: [S] },
);

check(
  "a colour-wise row naming no colour refuses",
  styleRate(
    S,
    [price(5, { type: "Color-wise", combo: null })],
    [qty(1000, { combo: "WHITE" })],
  ),
  null,
);

// Rows that agree are not contradictory, even spelled differently.
check(
  "the same colourway priced twice at one rate is one rate",
  styleRate(
    S,
    [
      price(5, { type: "Color-wise", combo: "WHITE" }),
      price(5, { type: "Color-wise", combo: " white " }),
    ],
    [qty(1000, { combo: "WHITE" })],
  ),
  5,
);

check(
  "the same colourway priced twice at DIFFERENT rates refuses",
  styleRate(
    S,
    [
      price(5, { type: "Color-wise", combo: "WHITE" }),
      price(6, { type: "Color-wise", combo: "WHITE" }),
    ],
    [qty(1000, { combo: "WHITE" })],
  ),
  null,
);

// ---------- Size-wise, and both axes ----------

check(
  "a size-wise rate is weighted by that size's pieces",
  styleRate(
    S,
    [
      price(4, { type: "Size-wise", size: SIZE_S }),
      price(6, { type: "Size-wise", size: SIZE_M }),
    ],
    [qty(750, { size: SIZE_S }), qty(250, { size: SIZE_M })],
  ),
  4.5,
);

// Both axes: the weight must match colour AND size, so a quantity that matches
// only one of them must not be counted toward the other's rate.
check(
  "colour-wise size-wise weights on both axes",
  styleRate(
    S,
    [
      price(5, { type: "Color-wise Size-wise", combo: "WHITE", size: SIZE_S }),
      price(9, { type: "Color-wise Size-wise", combo: "NAVY", size: SIZE_M }),
    ],
    [
      qty(800, { combo: "WHITE", size: SIZE_S }),
      qty(200, { combo: "NAVY", size: SIZE_M }),
      // Belongs to neither priced combination — must be ignored entirely, not
      // folded into whichever row matches on one axis.
      qty(500, { combo: "WHITE", size: SIZE_M }),
    ],
  ),
  5.8,
);

// ---------- Stale rows from a mode change ----------
//
// The operator switched Color-wise -> Style-wise and the old rows were KEPT
// (never delete typed money). The style now holds two modes; valuing it would
// mean silently picking one set.
check(
  "rows disagreeing about the mode refuse and name the style",
  orderValue(
    [style(1000)],
    [price(5, { type: "Style-wise" }), price(10, { type: "Color-wise", combo: "NAVY" })],
    [qty(1000, { combo: "NAVY" })],
  ),
  { grossValue: null, avgRate: null, unresolved: [S] },
);

// ---------- The whole-order rules the header states ----------

check(
  "an unresolved style poisons the TOTAL, never a partial sum",
  orderValue(
    [style(1000), style(2000, "TSH-002")],
    [price(5), price(4, { ref: "TSH-002" }), price(6, { ref: "TSH-002" })],
  ),
  { grossValue: null, avgRate: null, unresolved: ["TSH-002"] },
);

check(
  "a line with no quantity yet needs no rate",
  orderValue([style(1000), style(0, "TSH-002")], [price(5)]),
  { grossValue: 5000, avgRate: 5, unresolved: [] },
);

check(
  "nothing ordered is not worth zero",
  orderValue([style(0)], [price(5)]),
  { grossValue: null, avgRate: null, unresolved: [] },
);

// Six places, not two: 36000/7000 is 5.142857, and rounding a per-garment rate
// to paise loses real money on a large order.
check(
  "the average rate keeps six places",
  orderValue([style(7000)], [price(36000 / 7000)]).avgRate,
  5.142857,
);

// IEEE 754: 5000 * 4.2 is 21000.000000000004 before rounding.
check(
  "float noise never reaches the gross value",
  orderValue([style(5000)], [price(4.2)]).grossValue,
  21000,
);

// ---------------------------------------------------------------------------
// INR Value = Gross Value x Exchange Rate
//
// EVERY REFUSAL IS VECTORED, and they matter more than the answer: `ex_rate` is
// NOT NULL DEFAULT 0, so the untouched column multiplies a real Gross Value to
// 0.00 — a number that reads as "this order is worth nothing" rather than "no
// rate yet". That is the lie 0417 removed from the Gross Value itself.
// ---------------------------------------------------------------------------
check("INR value multiplies", inrValue(16000, 87.5, "USD"), 1400000);
check("INR value rounds to paise", inrValue(1234.56, 87.4321, "USD"), 107940.17);
check("a missing gross value stays missing", inrValue(null, 87.5, "USD"), null);
check("the column's default 0 refuses, never 0.00", inrValue(16000, 0, "USD"), null);
check("a blank rate refuses", inrValue(16000, null, "USD"), null);
check("a negative rate refuses", inrValue(16000, -87.5, "USD"), null);
check("NaN refuses", inrValue(16000, Number.NaN, "USD"), null);
// INR to INR is 1 by definition — a domestic order never waits on a rate.
check("an INR order converts at 1 with no rate typed", inrValue(16000, 0, "INR"), 16000);
check("an INR order ignores a rate typed in error", inrValue(16000, 87.5, "inr"), 16000);
// A blank currency is NOT assumed to be home — that would value a USD order
// whose currency has not been picked yet at its face figure in rupees.
check("a blank currency is not home", inrValue(16000, 0, null), null);
// The client's own worked example, converted: 5,000 pcs -> $16,000 -> INR.
check(
  "the spec example converts",
  inrValue(orderValue([style(5000)], [price(3.2)]).grossValue, 88, "USD"),
  1408000,
);
// A refusal upstream is still a refusal here: a style priced per colour with no
// weights makes the gross null, and null x a good rate must not become 0.
check(
  "an unresolved order has no INR value either",
  inrValue(
    orderValue(
      [style(5000)],
      [
        { style_ref_no: "S1", price_type: "Color-wise", combo: "WHITE", price: 2.5 },
        { style_ref_no: "S1", price_type: "Color-wise", combo: "RED", price: 3 },
      ],
    ).grossValue,
    88,
    "USD",
  ),
  null,
);

console.log(
  failed === 0
    ? "\nAll order-value vectors passed."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
