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
import {
  inrValue,
  isPackWise,
  orderValue,
  priceBasisOf,
  styleRate,
} from "../lib/orders/amendments/order-value.ts";
import {
  PACK_BRANCH_PRICE_MODES,
  isPackBranchMode,
} from "../lib/orders/amendments/types.ts";

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

// ---------------------------------------------------------------------------
// THE PACK BASIS — a rate per BOX, not per garment (0467, extended 2026-08-28)
//
// THIS FORK HAD NO VECTORS AT ALL until now. `priceBasisOf` decides whether $12
// is multiplied by 1,000 boxes or by the 3,000 garments inside them, and both
// check scripts in this repo predate the mode that introduced it. What it guards
// is a threefold overstatement of an order's value that looks entirely plausible
// on the commercial invoice that prints it.
// ---------------------------------------------------------------------------

const packStyle = (po_qty: number, packs: number | string | null, ref = S) => ({
  style_ref_no: ref,
  po_qty,
  packs_ordered: packs,
});

check("a per-garment mode is a piece basis", priceBasisOf(S, [price(5)]), "piece");
check(
  "Pack-wise is a pack basis",
  priceBasisOf(S, [price(12, { type: "Pack-wise" })]),
  "pack",
);
// THE REGRESSION THE SECOND MODE WOULD HAVE CAUSED. `priceBasisOf` compared
// `=== "pack-wise"`, so the size-wise sibling fell straight through it to
// "piece" and valued a BOX rate at the GARMENT count.
check(
  "Pack-wise Size-wise is a pack basis too",
  priceBasisOf(S, [price(12, { type: "Pack-wise Size-wise", size: SIZE_S })]),
  "pack",
);
check(
  "...which is what `isPackWise` answers, and it is ONE function",
  [isPackWise("Pack-wise"), isPackWise("Pack-wise Size-wise"), isPackWise("Size-wise")],
  [true, true, false],
);
check("a blank mode is not a pack", isPackWise(""), false);
check("and it is trimmed and case-folded like every other read here", isPackWise("  PACK-WISE  "), true);

// The client's own numbers: $12 a box, 1,000 boxes of a 3-piece pack.
check(
  "a pack rate is multiplied by BOXES",
  orderValue([packStyle(3000, 1000)], [price(12, { type: "Pack-wise" })]),
  // Gross is boxes x rate; the AVERAGE is per garment, so it is that over PO Qty.
  { grossValue: 12000, avgRate: 4, unresolved: [] },
);
check(
  "...and NOT by the garments inside them, which is 3x the order",
  orderValue([packStyle(3000, 1000)], [price(12, { type: "Pack-wise" })]).grossValue === 36000,
  false,
);
// A missing pack count REFUSES rather than falling back to the piece count — the
// fallback would be the exact wrong answer, reported as success.
check(
  "a pack-wise style with no pack count is unresolved, never valued at pieces",
  orderValue([style(3000)], [price(12, { type: "Pack-wise" })]),
  { grossValue: null, avgRate: null, unresolved: ["TSH-001"] },
);

// ---------------------------------------------------------------------------
// PACK-WISE SIZE-WISE — one rate per box per size (client 2026-08-28)
//
//   "The overall 5-Piece Gift Pack has a set unit rate for Size S."
//
// THE BLEND NEEDS NO NEW WEIGHT, and this section is the PROOF rather than the
// claim. `styleRate` weights by PIECES; the value needs a weighting by BOXES. A
// method has ONE composition applied to every size, so pieces = boxes x packSize
// with packSize constant, and a constant cancels out of a weighted average.
//
// Below: 100 boxes of S at $10 and 300 boxes of M at $20, a 3-piece pack, so
// 300 and 900 pieces.
//
//   by boxes:   (10x100 + 20x300) / 400   = 17.5
//   by pieces:  (10x300 + 20x900) / 1200  = 17.5      <- identical
//   gross:      17.5 x 400 boxes          = 7,000
//   and directly: 10x100 + 20x300         = 7,000     <- agrees
// ---------------------------------------------------------------------------

const PWS = "Pack-wise Size-wise";
const gift = [
  price(10, { type: PWS, size: SIZE_S }),
  price(20, { type: PWS, size: SIZE_M }),
];
const giftQtys = [qty(300, { size: SIZE_S }), qty(900, { size: SIZE_M })];

check(
  "the per-size box rates blend to the box-weighted average",
  styleRate(S, gift, giftQtys),
  17.5,
);
check(
  "and the order is worth the sum of rate x boxes, exactly",
  orderValue([packStyle(1200, 400)], gift, giftQtys),
  { grossValue: 7000, avgRate: 5.833333, unresolved: [] },
);
// THE ARITHMETIC RESTATED WITHOUT THE BLEND, so the cancellation is asserted
// against the thing it must equal rather than against itself.
check(
  "...which is 10x100 + 20x300",
  orderValue([packStyle(1200, 400)], gift, giftQtys).grossValue,
  10 * 100 + 20 * 300,
);
// AND IT IS NOT THE PIECE ANSWER. The same blended rate times 1,200 garments is
// 21,000 — three times the order, and a number that looks fine.
check(
  "a size-wise BOX rate is not multiplied by garments",
  orderValue([packStyle(1200, 400)], gift, giftQtys).grossValue === 21000,
  false,
);
// The size axis is genuinely open: a row naming no size is half-answered and
// refuses, exactly as Size-wise does.
check(
  "a pack-wise size-wise row naming no size refuses",
  styleRate(S, [price(10, { type: PWS })], giftQtys),
  null,
);
// A priced size with no boxes behind it refuses too — the partial-sum rule.
check(
  "a priced size with no quantity refuses rather than dropping out of the average",
  styleRate(S, gift, [qty(300, { size: SIZE_S })]),
  null,
);
// Mixing the two pack modes on one style is stale rows from a mode change, and
// is refused like every other mixed-mode style.
check(
  "the two pack modes do not average together",
  styleRate(S, [price(12, { type: "Pack-wise" }), price(10, { type: PWS, size: SIZE_S })], giftQtys),
  null,
);

// ---------------------------------------------------------------------------
// PACK_GROUP — a box is valued ONCE, however many styles ride in it
// (client 2026-08-28)
//
// A pack rate is a rate per BOX; this module's loop is per STYLE. A three-style
// baby gift box at $12 with 400 boxes was valued 3 x (12 x 400) = 14,400 against
// a true 4,800 — AND REPORTED WITH `unresolved: []`, i.e. as a confident correct
// answer, on the screen that prints the commercial invoice.
//
// 0467 never exposed it: a set pack was one style per pack. The multi-style box
// is what made the box and the style stop being the same thing.
// ---------------------------------------------------------------------------

const BOXES = 400;
const giftMember = (ref: string, group: string | null = "BABY GIFT BOX") => ({
  style_ref_no: ref,
  po_qty: BOXES, // one garment of this style per box
  packs_ordered: BOXES,
  pack_group: group,
});
const boxRate = (ref: string, p = 12) => ({
  style_ref_no: ref,
  price_type: "Pack-wise",
  combo: null,
  size_id: null,
  price: p,
});

const F = "STL/0101";
const H = "STL/0102";
const L = "STL/0103";
const giftStyles = [giftMember(F), giftMember(H), giftMember(L)];
const giftPrices = [boxRate(F), boxRate(H), boxRate(L)];

check(
  "three styles in one box are worth ONE box price",
  orderValue(giftStyles, giftPrices),
  // 12 x 400 = 4,800 for the boxes; the average is per GARMENT, and there are
  // 1,200 garments in those 400 boxes, so 4,800 / 1,200 = 4.
  { grossValue: 4800, avgRate: 4, unresolved: [] },
);
// THE REGRESSION AS ITSELF.
check(
  "...and NOT three times that, which is what a per-style loop returns",
  orderValue(giftStyles, giftPrices).grossValue === 14400,
  false,
);
// The garments are real even though the box is paid for once — the average rate
// is per garment and must count every one of them.
check(
  "every member's garments still count towards the average",
  orderValue(giftStyles, giftPrices).avgRate,
  4800 / (BOXES * 3),
);

// FAIL FAST ON A DISAGREEMENT (the client's ruling). One physical carton cannot
// have two prices, and picking the first would make the value depend on row
// order.
check(
  "two members quoting different rates for one box refuse, and are NAMED",
  orderValue(giftStyles, [boxRate(F), boxRate(H, 15), boxRate(L)]),
  { grossValue: null, avgRate: null, unresolved: ["STL/0102"] },
);
check(
  "two members reporting different box counts refuse too",
  orderValue(
    [giftMember(F), { ...giftMember(H), packs_ordered: 500 }, giftMember(L)],
    giftPrices,
  ),
  { grossValue: null, avgRate: null, unresolved: ["STL/0102"] },
);

// A STYLE WITH NO GROUP IS VALUED EXACTLY AS BEFORE — that is what makes the
// field additive and every existing caller correct without being edited.
check(
  "an ungrouped pack style is valued on its own, as it always was",
  orderValue([giftMember(F, null)], [boxRate(F)]),
  { grossValue: 4800, avgRate: 12, unresolved: [] },
);
check(
  "and a caller that passes no group at all is unchanged",
  orderValue(
    [{ style_ref_no: F, po_qty: 400, packs_ordered: 400 }],
    [boxRate(F)],
  ),
  { grossValue: 4800, avgRate: 12, unresolved: [] },
);

// THE GROUP IS ONLY EVER READ ON A PACK BASIS. Two piece-priced styles that
// happen to share a carton are two real quantities of garments, and collapsing
// them would UNDER-value the order — the mirror image of the bug above.
check(
  "a group does not collapse PIECE-priced styles",
  orderValue(
    [
      { style_ref_no: F, po_qty: 400, pack_group: "BABY GIFT BOX" },
      { style_ref_no: H, po_qty: 400, pack_group: "BABY GIFT BOX" },
    ],
    [price(5, { ref: F }), price(5, { ref: H })],
  ),
  { grossValue: 4000, avgRate: 5, unresolved: [] },
);

// Two different boxes on one order are two boxes.
check(
  "separate groups are valued separately",
  orderValue(
    [giftMember(F), giftMember(H), giftMember(L, "GIFT TIN")],
    giftPrices,
  ),
  // BABY GIFT BOX once (4,800) + GIFT TIN once (4,800) = 9,600 over 1,200 pieces
  { grossValue: 9600, avgRate: 8, unresolved: [] },
);
// Group names compare like every other stored word here.
check(
  "group names are trimmed and case-folded",
  orderValue(
    [giftMember(F, "  baby gift box "), giftMember(H), giftMember(L)],
    giftPrices,
  ).grossValue,
  4800,
);

// ---------------------------------------------------------------------------
// SIZE-WISE ON A PACK ORDER — the third mode the pack branch offers (operator
// request, 2026-08-28), and the first one there that prices a GARMENT.
//
// THE RISK IS NOT ARITHMETIC, IT IS A CONFLATED PREDICATE. `isPackWise` had two
// jobs until now: "does this rate multiply by boxes?" and "may a pack order
// choose this mode?" — the same list, so one function served both. They part
// company here, and each direction of the confusion has its own damage:
//
//   read `isPackWise` where the DROPDOWN is meant  -> Size-wise is not offered,
//                                                    or worse, is offered and
//                                                    then read back as "no mode"
//                                                    so the typed rates vanish;
//   read `isPackBranchMode` where the BASIS is meant -> a garment rate is
//                                                    multiplied by the box count.
//
// So the two are asserted against each other, on the one mode that separates
// them.
// ---------------------------------------------------------------------------

check(
  "the pack branch offers three modes, in the tuple's reading order",
  [...PACK_BRANCH_PRICE_MODES],
  ["Pack-wise", "Pack-wise Size-wise", "Size-wise"],
);
check(
  "...and Size-wise is the one the two predicates disagree about",
  ["Pack-wise", "Pack-wise Size-wise", "Size-wise", "Color-wise"].map((m) => [
    isPackBranchMode(m),
    isPackWise(m),
  ]),
  [[true, true], [true, true], [true, false], [false, false]],
);
check(
  "a mode is matched trimmed and case-folded, so a row saved earlier reads back",
  [isPackBranchMode("  SIZE-WISE "), isPackBranchMode(""), isPackBranchMode(null)],
  [true, false, false],
);

// THE BASIS IS UNMOVED, which is the assertion that matters: the dropdown grew
// and `priceBasisOf` did not change its mind about anything.
check(
  "Size-wise stays a PIECE basis however it was reached",
  priceBasisOf(S, [price(12, { type: "Size-wise", size: SIZE_S })]),
  "piece",
);

// The same 3-style gift box as the section above, priced per GARMENT instead of
// per box. Both figures below are correct; they are answers to different
// questions, which is exactly why the grid's rate column has to name its unit.
const pieceRate = (ref: string, p = 12) => ({
  style_ref_no: ref,
  price_type: "Size-wise",
  combo: null,
  size_id: SIZE_S,
  price: p,
});
const piecePrices = [pieceRate(F), pieceRate(H), pieceRate(L)];
/* A SIZE-WISE RATE STILL NEEDS ITS QUANTITIES, and the first cut of these
   vectors forgot it — all three refused. That is not noise: the size axis is
   open under this mode, so `styleRate` blends per size and a priced size with no
   pieces behind it refuses rather than dropping out of the average (the vector
   two sections up). Which means SWITCHING A METHOD TO SIZE-WISE MAKES THE ORDER
   DEPEND ON THE QUANTITIES TAB in a way Pack-wise never did. Worth knowing
   before an operator reports the Logistic tab as broken. */
const pieceQtys = [
  qty(BOXES, { size: SIZE_S, ref: F }),
  qty(BOXES, { size: SIZE_S, ref: H }),
  qty(BOXES, { size: SIZE_S, ref: L }),
];

check(
  "a piece-priced pack is worth every garment in it, not one box",
  orderValue(giftStyles, piecePrices, pieceQtys),
  // 3 styles x 400 garments x 12 = 14,400 over 1,200 pieces.
  { grossValue: 14400, avgRate: 12, unresolved: [] },
);
check(
  "...which is 3x the SAME figure typed under Pack-wise, and both are right",
  [
    orderValue(giftStyles, giftPrices).grossValue,
    orderValue(giftStyles, piecePrices, pieceQtys).grossValue,
  ],
  [4800, 14400],
);
// `pack_group` is read only on a pack basis, so the members are NOT collapsed
// here even though they share a carton — the general rule is vectored above;
// this is it arriving through the pack branch, which is how it will be hit.
check(
  "the carton does not collapse a piece-priced method",
  orderValue(giftStyles, piecePrices, pieceQtys).grossValue !== 4800,
  true,
);
// A pack count is irrelevant to a piece basis, so its absence must not refuse —
// the mirror of "a pack-wise style with no pack count is unresolved".
check(
  "a piece-priced pack style with no pack count still values",
  orderValue(
    [{ style_ref_no: F, po_qty: BOXES, pack_group: "BABY GIFT BOX" }],
    [pieceRate(F)],
    [qty(BOXES, { size: SIZE_S, ref: F })],
  ),
  { grossValue: 4800, avgRate: 12, unresolved: [] },
);

console.log(
  failed === 0
    ? "\nAll order-value vectors passed."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
