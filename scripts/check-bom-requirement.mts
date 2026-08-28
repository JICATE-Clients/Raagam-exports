/**
 * Vectors for `lib/orders/material-bom/requirement.ts` — how much of a material
 * a garment order needs.
 *
 * THIS MODULE'S OUTPUT IS SPENT. It is stored as the quantity a purchase order
 * is checked against, so its failure mode is not a wrong pixel — it is buying
 * six times too much of a trim, or too little to finish the order. Like
 * `order-value.ts` it has more refusal branches than answering ones, and a suite
 * that only walked the happy path would let every one of them rot into a
 * plausible number.
 *
 * ## THE CLIENT'S OWN EXAMPLES PROVE ALMOST NOTHING, AND THAT IS THE POINT
 *
 * "2 labels on 600 pieces is 1,200" and "1 metre makes 4 pieces" both divide
 * EVENLY, so every rounding bug in this engine is invisible on them — exactly
 * what `rejectionFor`'s header says about 50 + 8% = 54. The vectors that earn
 * their place are the ones built so two plausible implementations DISAGREE:
 *
 *   - 600 / 7 separates ceil from round-to-nearest AND from whole-unit rounding;
 *   - a target of 670 rather than 600 separates the production target from the
 *     PO quantity, which is the entire premise of the feature;
 *   - the cross-basis invariant separates a per-combo sum from a re-derived one.
 *
 * ## Why this runs under `tsx` and most `check-*.mts` run under bare node
 *
 * The same reason `check-order-value.mts` does, one level worse. This engine
 * imports `approval-qty.ts` at RUNTIME, which imports the ALIAS
 * `@/lib/masters/rejection-rule`. Node's ESM resolver refuses both the missing
 * extension and the alias; `tsx` reads `paths` out of tsconfig. The imports are
 * not incidental and must not be flattened to suit a runner — sharing ONE
 * production-target function with the order screen is the whole reason this
 * module can be trusted.
 */
import {
  apportion,
  basisFingerprint,
  basisOf,
  isRefusal,
  moqRollup,
  roundUpTo,
  colourSplits,
  lineQuantity,
  lineQuantityByColour,
  panelConsumption,
  productionSlices,
  baseRequirementFor,
  requirementFor,
  totalProductionOf,
  toPurchaseSlices,
  type ApprovalRow,
  type AssortSizeRow,
  type BomLineInput,
  type ComboRow,
  type OrderProductionInput,
  type ProductionSlice,
  type RequirementBasis,
} from "../lib/orders/material-bom/requirement.ts";
import {
  resolveLinePack,
  type PackRow,
} from "../lib/orders/material-bom/pack-resolve.ts";
import type { RejectionTier } from "../lib/masters/rejection-rule.ts";
import { fmtQty } from "../lib/uom/convert.ts";

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

/** Asserts a value is NOT something — for the wrong answers a plausible
 *  implementation produces. A vector that only states the right answer cannot
 *  say which wrong one it was guarding against. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(forbidden);
  if (same) {
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

const S1 = "TSH-001";
const S2 = "TSH-002";
const SZ_S = "11111111-1111-1111-1111-111111111111";
const SZ_M = "22222222-2222-2222-2222-222222222222";
const SZ_L = "33333333-3333-3333-3333-333333333333";
const SIZE_NAMES: Record<string, string> = { [SZ_S]: "S", [SZ_M]: "M", [SZ_L]: "L" };

const approval = (qty: number, combo = "WHITE", ref = S1, approvalQty = 0): ApprovalRow => ({
  style_ref_no: ref,
  combo,
  qty,
  approval_qty: approvalQty,
});
const combo = (name = "WHITE", ref = S1): ComboRow => ({ style_ref_no: ref, combo: name });
const assort = (size: string, qty: number, comboName = "WHITE", ref = S1): AssortSizeRow => ({
  style_ref_no: ref,
  combo: comboName,
  size_id: size,
  qty,
});

function order(over: Partial<OrderProductionInput> = {}): OrderProductionInput {
  return {
    excessPct: 0,
    rejectionRuleChosen: false,
    tiers: null,
    approvals: [approval(600)],
    combos: [combo()],
    assortSizes: [],
    sizeNames: SIZE_NAMES,
    ...over,
  };
}

const line = (over: Partial<BomLineInput> = {}): BomLineInput => ({
  no_of_items: 2,
  per_pieces: 1,
  excess_pct: 0,
  decimals: 2,
  ...over,
});

/** The whole pipeline for one basis, as the screen and the server both run it. */
function required(basis: RequirementBasis, o: OrderProductionInput, l: BomLineInput) {
  const slices = productionSlices(basis, o);
  if (isRefusal(slices)) return slices;
  return slices.map((s) => ({ label: s.label, value: requirementFor(l, s) }));
}
function totalOf(rows: ReturnType<typeof required>): number | null {
  if (isRefusal(rows)) return null;
  let sum = 0;
  for (const r of rows) {
    if (isRefusal(r.value)) return null;
    sum += r.value;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// 1. The client's published examples
// ---------------------------------------------------------------------------

check(
  "2 labels per piece on 600 pcs = 1,200",
  required("order", order(), line()),
  [{ label: "Whole order", value: 1200 }],
);

check(
  "1 metre makes 4 pieces: 600 pcs = 150 m",
  required("order", order(), line({ no_of_items: 1, per_pieces: 4 })),
  [{ label: "Whole order", value: 150 }],
);

// ---------------------------------------------------------------------------
// 2. Rounding — where the published examples are blind
// ---------------------------------------------------------------------------

const sevenths = required("order", order(), line({ no_of_items: 1, per_pieces: 7 }));

check("600 / 7 rounds UP to 85.72", sevenths, [{ label: "Whole order", value: 85.72 }]);
refute("600 / 7 is not round-to-nearest (85.71)", sevenths, [
  { label: "Whole order", value: 85.71 },
]);
refute("600 / 7 is not whole-unit rounding (86) — the decimal_places trap", sevenths, [
  { label: "Whole order", value: 86 },
]);

// The trap in production is a service that selects `decimal_places` (0 on every
// live row) instead of `decimal_places_allowed`. That reaches the engine as a 0,
// so the vector feeds a 0 and asserts the clamp in `uomPrecision` absorbs it.
// Without the floor of 2 this reads 86 and the client's rejected round-up is back.
check(
  "a UOM reporting 0 decimals still gets 2 — the clamp is load-bearing",
  required("order", order(), line({ no_of_items: 1, per_pieces: 7, decimals: 0 })),
  [{ label: "Whole order", value: 85.72 }],
);

// 600 / 4 is exactly 150 in decimal and 150.00000000000003 in binary once it has
// been through a multiply. Ceiling turns that invisible artefact into a visible
// hundredth, so the guard in ceilToPrecision is what this asserts.
refute(
  "an exact 150 does not drift to 150.01",
  required("order", order(), line({ no_of_items: 1, per_pieces: 4 })),
  [{ label: "Whole order", value: 150.01 }],
);

check(
  "wastage 3% on 1,200 = 1,236",
  required("order", order(), line({ excess_pct: 3 })),
  [{ label: "Whole order", value: 1236 }],
);
check(
  "wastage 5% on 1,200 = 1,260",
  required("order", order(), line({ excess_pct: 5 })),
  [{ label: "Whole order", value: 1260 }],
);

// The client's own published excess figures, stated as a BASE of 600 rather
// than as an order of 600: "if a base requirement is 600 units and a 3% material
// excess is applied, the Calculated field will display 618 (or 630 depending on
// the buffer)". One item per one piece makes the base equal the target, which is
// what lets their arithmetic be asserted directly.
check(
  "client: base 600 + 3% material excess = 618",
  required("order", order(), line({ no_of_items: 1, per_pieces: 1, excess_pct: 3 })),
  [{ label: "Whole order", value: 618 }],
);
check(
  "client: base 600 + 5% material excess = 630",
  required("order", order(), line({ no_of_items: 1, per_pieces: 1, excess_pct: 5 })),
  [{ label: "Whole order", value: 630 }],
);
// THE ORDER'S EXCESS % IS BACK INSIDE THE BASE (client 2026-08-21), and this
// vector asserted the opposite for one day. The two buffers are separate and
// both apply, in this order: the buyer's 5% lifts the PIECES to 630, then the
// material's own 3% lifts the TRIMS on top of that.
//
//     630 x 1.03 = 648.9
//
// NOT COMPOUNDED IN THE OTHER DIRECTION, and the refutation below is what pins
// that: 618 is the material excess alone, which is what this said until today.
check(
  "the order's Excess % and the material's own both apply",
  required(
    "order",
    order({ excessPct: 5 }),
    line({ no_of_items: 1, per_pieces: 1, excess_pct: 3 }),
  ),
  [{ label: "Whole order", value: 648.9 }],
);
refute(
  "not 618 — that is the material's 3% with the buyer's 5% dropped",
  required(
    "order",
    order({ excessPct: 5 }),
    line({ no_of_items: 1, per_pieces: 1, excess_pct: 3 }),
  ),
  [{ label: "Whole order", value: 618 }],
);

// ---------------------------------------------------------------------------
// 3. The base is PO + BUYER'S EXCESS + APPROVAL, and never the rejection
//    (client 2026-08-21)
//
// THIS SECTION HAS NOW ASSERTED THREE DIFFERENT ANSWERS, and keeping all three
// visible is the point of it. In date order:
//
//   0418 · 2026-08-12   qty + excess + approval + rejection   = 670  -> 1,340
//   2026-08-20          the entered quantity alone            = 600  -> 1,200
//   2026-08-21          qty + excess + approval, no rejection = 640  -> 1,280
//
// The 08-20 instruction came from an order showing 5,552 against a 5,000 PO.
// That figure is 5,000 + 252 excess + 300 approval — i.e. exactly what the
// 08-21 formula produces — and the 300 turned out to be 20 filled down across
// fifteen size rows. So the reversal was aimed at a data-entry mistake and the
// formula was never the thing that was wrong. Confirmed with the client against
// those numbers before this was changed back.
//
// FOUR NEIGHBOURS ARE REFUTED, not one, because this figure has three plausible
// wrong answers that all look reasonable: 600 (the 08-20 rule), 630 (excess but
// no approval), 610 (approval but no excess) and 670 (the full target). Only
// 640 separates all four, which is why the fixture carries a rejection rule it
// must then ignore.
// ---------------------------------------------------------------------------

const TIERS: RejectionTier[] = [
  { from_value: 1, to_value: 100, rejection_allowance: 3, allowance_type: "flat" },
  { from_value: 101, to_value: null, rejection_allowance: 5, allowance_type: "percent" },
];

// 600 ordered + 5% excess (30) + 10 approval + 5% projection (30) = 670.
const richOrder = order({
  excessPct: 5,
  rejectionRuleChosen: true,
  tiers: TIERS,
  approvals: [approval(600, "WHITE", S1, 10)],
});

// `totalProductionOf` is the BOM's OWN view of the order: 600 + 30 excess + 10
// approval = 640. `productionTarget` in `approval-qty.ts` still computes 670 and
// the Approval Qty tab still shows it, because the tab reports what the FLOOR is
// asked to make and this reports what the TRIMS are bought for. The two are
// deliberately different numbers and the gap is exactly the rejection allowance.
check("the BOM plans 600 + 30 excess + 10 approval", totalProductionOf(richOrder), 640);
refute("not 670 — the rejection allowance is the ORDER's target, not a trim's", totalProductionOf(richOrder), 670);
refute("not 600 — that was the 2026-08-20 rule and it is superseded", totalProductionOf(richOrder), 600);
check(
  "2 labels on that base = 1,280",
  required("order", richOrder, line()),
  [{ label: "Whole order", value: 1280 }],
);
// FOUR REFUTATIONS, one per plausible mis-implementation. Each is a number a
// wrong engine actually returns, not a number picked to look different.
refute(
  "not 1,340 — that is the full production target, rejection and all",
  required("order", richOrder, line()),
  [{ label: "Whole order", value: 1340 }],
);
refute(
  "not 1,200 — an engine still reading the entered quantity alone",
  required("order", richOrder, line()),
  [{ label: "Whole order", value: 1200 }],
);
refute("no excess in it — that answers 1,220", required("order", richOrder, line()), [
  { label: "Whole order", value: 1220 },
]);
refute("no approval pieces in it — that answers 1,260", required("order", richOrder, line()), [
  { label: "Whole order", value: 1260 },
]);

// THE REJECTION GAP MUST NOT COME BACK WITH THE EXCESS. `productionTarget`
// REFUSES when a rule is named and no tier covers the quantity — correct for the
// Approval Qty tab, and wrong here, because a trim is not bought against the
// rejection allowance at all. An engine "restored to 0418" brings that refusal
// with it, and this is the vector that catches it.
const gapOrder = order({
  excessPct: 5,
  rejectionRuleChosen: true,
  tiers: [{ from_value: 1, to_value: 50, rejection_allowance: 3, allowance_type: "flat" }],
  approvals: [approval(600, "WHITE", S1, 10)],
});
check("a tier gap does not stop a material", refusalOf(productionSlices("order", gapOrder)), null);
check("and the base is unchanged by the gap", totalProductionOf(gapOrder), 640);

// EXCESS IS PER APPROVAL ROW, NOT ON THE TOTAL — the client's own worked example
// (`excessQty`'s header: 500 at 5% reads as 25, not 24). Two rows of 250 round
// to 13 each; the summed 500 would round once to 25.
const splitRows = order({
  excessPct: 5,
  approvals: [approval(250, "WHITE", S1, 0), approval(250, "WHITE", S1, 0)],
  combos: [combo("WHITE", S1)],
});
check("the buyer's excess rounds per row: 13 + 13", totalProductionOf(splitRows), 526);
refute("not 525, which is the summed 500 rounded once", totalProductionOf(splitRows), 525);

// ---------------------------------------------------------------------------
// 3b. ONE COLOURWAY IS ONE SLICE, however many approval rows it is typed on
//
// 0435 made Approval Qty a row per SIZE, so a three-colour order carrying five
// sizes now arrives here as FIFTEEN rows rather than three. `targetsOf` reads
// one target per ROW, so `colour` mapped them 1:1 and emitted five identical
// WHITE slices — same key, same label, a fifth of the quantity each.
//
// THE TOTAL WAS NEVER WRONG, WHICH IS WHY NOTHING CAUGHT IT. Every existing
// vector in this file sums, and five slices of 100 sum exactly as one of 500.
// What breaks is IDENTITY: `uq_mba_req_slice (item_line_id, style_ref_no,
// combo, size_id) nulls not distinct` refuses the second insert, so saving a
// colour-wise BOM against a real order fails outright.
//
// So these assert the SHAPE, not the arithmetic — the count, the label, and the
// key. All three, because a count alone passes against a broken bucket key.
// ---------------------------------------------------------------------------

// One colourway, two approval rows — what a two-size order looks like since 0435.
const perSize = order({
  approvals: [approval(300, "WHITE", S1), approval(200, "WHITE", S1)],
  combos: [combo("WHITE", S1)],
  assortSizes: [assort(SZ_S, 1, "WHITE", S1), assort(SZ_M, 1, "WHITE", S1)],
});

check("two approval rows on one colourway are ONE colour slice", required("colour", perSize, line()), [
  { label: "WHITE", value: 1000 },
]);
refute("not one slice per approval row", required("colour", perSize, line()), [
  { label: "WHITE", value: 600 },
  { label: "WHITE", value: 400 },
]);

// THE KEY IS THE HALF THE DATABASE ENFORCES, so assert it directly rather than
// inferring it from the count — a fold that produced one row with the wrong key
// would satisfy everything above.
for (const basis of ["order", "style", "colour", "size", "combination"] as const) {
  const slices = productionSlices(basis, perSize);
  if (isRefusal(slices)) {
    check(`${basis} slices do not refuse`, slices.refused, null);
    continue;
  }
  check(
    `${basis} slice keys are unique`,
    new Set(slices.map((s) => s.key)).size,
    slices.length,
  );
}

// ---------------------------------------------------------------------------
// 4. The cross-basis invariant — the strongest vector in the file
// ---------------------------------------------------------------------------

// 301 and 199, NOT 300 and 200 — and the buyer's excess is back on them
// (2026-08-21), which is the arrangement this pair was chosen for in the first
// place: 301 -> +16 and 199 -> +10 gives 526, against 525 for an engine that
// summed to 500 and took 5% once. It earns its place twice over, because
// apportioning 317 over 2:3:5 also leaves remainders that a round number does
// not — so a size split that rounded each share instead of using
// largest-remainder is still caught below.
const threeWay = order({
  excessPct: 5,
  approvals: [approval(301, "WHITE"), approval(199, "NAVY")],
  combos: [combo("WHITE"), combo("NAVY")],
  assortSizes: [
    assort(SZ_S, 2, "WHITE"),
    assort(SZ_M, 3, "WHITE"),
    assort(SZ_L, 5, "WHITE"),
    assort(SZ_S, 1, "NAVY"),
    assort(SZ_M, 1, "NAVY"),
  ],
});

// The multiplier here is exact (2 items / 1 piece / 0% wastage) on purpose: a
// per-slice ceil is not distributive over a sum, so a fractional ratio would
// make the three totals legitimately differ and this invariant would be testing
// arithmetic instead of the slicing.
const byOrder = totalOf(required("order", threeWay, line()));
const byStyle = totalOf(required("style", threeWay, line()));
const byColour = totalOf(required("colour", threeWay, line()));
const bySize = totalOf(required("size", threeWay, line()));
const byCombo = totalOf(required("combination", threeWay, line()));

check(
  "order / style / colour / size / combination totals all agree",
  [byOrder, byStyle, byColour, bySize, byCombo],
  [byOrder, byOrder, byOrder, byOrder, byOrder],
);
// 2 x (317 + 209), the per-row excess included.
check("and the figure is 2 x (317 + 209)", byOrder, 1052);
refute("not 2 x 525 — that is excess taken once on the summed quantity", byOrder, 1050);
refute("not 2 x 500 — that is the entered quantity with no excess at all", byOrder, 1000);

// ---------------------------------------------------------------------------
// 4b. THE STYLE BASIS (0440)
//
// `threeWay` above is ONE style, so it proves the invariant and nothing about
// the split. This order carries two, with a colour under each, so a style slice
// has to gather its own colours and no others.
// ---------------------------------------------------------------------------

const styleAxis = order({
  approvals: [
    approval(300, "WHITE", S1),
    approval(200, "NAVY", S1),
    approval(150, "WHITE", S2),
  ],
  combos: [combo("WHITE", S1), combo("NAVY", S1), combo("WHITE", S2)],
});

check(
  "a style slice sums the colours under THAT style",
  (productionSlices("style", styleAxis) as ProductionSlice[]).map((s) => [s.label, s.qty]),
  [[S1, 500], [S2, 150]],
);
// A count vector passes against a broken bucket key — assert who got NAMED.
check(
  "style slices are labelled with the style refs",
  (productionSlices("style", styleAxis) as ProductionSlice[]).map((s) => s.label),
  [S1, S2],
);
refute(
  "not one slice — that would be `order` wearing the style basis' name",
  (productionSlices("style", styleAxis) as ProductionSlice[]).length,
  1,
);
// A style-wise line is bought once for the style whatever colour it is made in,
// so the colour must NOT survive into the slice. If it did, two colourways of
// one style would each buy the woven label that carries that style's art.
check(
  "a style slice carries no combo",
  (productionSlices("style", styleAxis) as ProductionSlice[]).every((s) => s.combo === null),
  true,
);
check(
  "and no size",
  (productionSlices("style", styleAxis) as ProductionSlice[]).every((s) => s.size_id === null),
  true,
);
check(
  "the style totals still sum to the whole order",
  (productionSlices("style", styleAxis) as ProductionSlice[]).reduce((a, s) => a + s.qty, 0),
  650,
);

// THE PLACEMENT VECTOR, and the reason the branch sits above the colour checks.
// A style total reads Approval Qty alone, so a Combos tab that has drifted out
// of step must not refuse it — `colour` legitimately refuses here and `style`
// must not, or a BOM planned per style stops over a colour rename it never reads.
const comboDrift = order({
  approvals: [approval(300, "WHITE", S1), approval(200, "NAVY", S1)],
  combos: [combo("WHITE", S1)], // NAVY quantified but no longer declared
});
check(
  "style-wise survives a Combos/Approval disagreement",
  (productionSlices("style", comboDrift) as ProductionSlice[]).map((s) => s.qty),
  [500],
);
check(
  "and colour-wise still refuses it",
  isRefusal(productionSlices("colour", comboDrift)),
  true,
);

check(
  "colour slices are labelled with the combo names",
  (productionSlices("colour", threeWay) as ProductionSlice[]).map((s) => s.label),
  ["WHITE", "NAVY"],
);
// THE VECTOR THAT WOULD HAVE CAUGHT THE SHIPPED BUG. Size-wise was emitting the
// COMBINATION matrix under the wrong name: WHITE · M and NAVY · M as separate
// rows, when the question a size label asks is "how many Mediums are there?".
//
// The arithmetic, so a reader can check it rather than trust it:
//   WHITE 301 + ceil(5%) 16 = 317, apportioned over a 2:3:5 curve -> 63 / 95 / 159
//   NAVY  199 + ceil(5%) 10 = 209, apportioned over a 1:1  curve -> 105 / 104
//   size-wise  S 63+105=168   M 95+104=199   L 159+0=159   (526 total)
//
// Note the two colourways carry DIFFERENT size curves, which is exactly why the
// matrix is apportioned per combo before being summed by size.
check(
  "size-wise gives ONE row per size, colour collapsed",
  (productionSlices("size", threeWay) as ProductionSlice[]).map((s) => [s.label, s.qty]),
  [
    ["S", 168],
    ["M", 199],
    ["L", 159],
  ],
);
refute(
  "…and does NOT name the colour",
  (productionSlices("size", threeWay) as ProductionSlice[]).map((s) => s.label),
  ["WHITE · S", "WHITE · M", "WHITE · L", "NAVY · S", "NAVY · M"],
);
check(
  "…nor carries one",
  (productionSlices("size", threeWay) as ProductionSlice[]).every((s) => s.combo === null),
  true,
);

// Combination IS the matrix — one row per SKU, colour and size both named.
check(
  "combination names the combo AND the size",
  (productionSlices("combination", threeWay) as ProductionSlice[]).map((s) => s.label),
  ["WHITE · S", "WHITE · M", "WHITE · L", "NAVY · S", "NAVY · M"],
);
check(
  "size-wise has FEWER rows than combination on a multi-colour order",
  [
    (productionSlices("size", threeWay) as ProductionSlice[]).length,
    (productionSlices("combination", threeWay) as ProductionSlice[]).length,
  ],
  [3, 5],
);
// Each size row is exactly its column of the matrix — M is WHITE-M + NAVY-M,
// i.e. 95 + 104 against the excess-bearing targets of 317 and 209.
check(
  "a size row is exactly that size's column of the matrix (M = 95 + 104)",
  (productionSlices("combination", threeWay) as ProductionSlice[])
    .filter((s) => s.label.endsWith("· M"))
    .reduce((a, s) => a + s.qty, 0),
  199,
);

// WHITE under two styles must not be merged into one bucket.
const twoStyles = order({
  approvals: [approval(300, "WHITE", S1), approval(200, "WHITE", S2)],
  combos: [combo("WHITE", S1), combo("WHITE", S2)],
});
check(
  "the same combo under two styles stays two slices, each named by style",
  (productionSlices("colour", twoStyles) as ProductionSlice[]).map((s) => [s.label, s.qty]),
  [
    ["TSH-001 · WHITE", 300],
    ["TSH-002 · WHITE", 200],
  ],
);

// ---------------------------------------------------------------------------
// 5. Size apportionment
// ---------------------------------------------------------------------------

check("largest remainder: 2:3:5 over 1,000", apportion(1000, [2, 3, 5]), [200, 300, 500]);
check("1:1:1 over 1,000 sums to exactly 1,000", apportion(1000, [1, 1, 1]), [334, 333, 333]);
check(
  "…and no share is zero",
  apportion(1000, [1, 1, 1]).every((n) => n > 0),
  true,
);
check(
  "ceil-per-size would have overshot",
  apportion(1000, [1, 1, 1]).reduce((a, b) => a + b, 0),
  1000,
);

// The assortment is a RATIO. These pieces cover one country of a two-country
// order, so reading them as absolute would buy for a third of the order.
const partialAssort = order({
  approvals: [approval(900)],
  combos: [combo()],
  assortSizes: [assort(SZ_S, 1), assort(SZ_M, 1), assort(SZ_L, 1)],
});
check(
  "a part-entered assortment still apportions the FULL target",
  (productionSlices("size", partialAssort) as ProductionSlice[]).map((s) => s.qty),
  [300, 300, 300],
);
refute(
  "…and is not read as absolute pieces",
  (productionSlices("size", partialAssort) as ProductionSlice[]).map((s) => s.qty),
  [1, 1, 1],
);

// The user ruled out an even split across the style's declared sizes. Prove it
// is absent, not merely unwritten.
const noAssort = order({ approvals: [approval(600)], combos: [combo()], assortSizes: [] });
check(
  "size with no assort detail refuses, naming the tab",
  refusalOf(productionSlices("size", noAssort)),
  "Size break-up not entered on Quantities ▸ Assort",
);
check(
  "combination with no assort detail refuses the same way",
  refusalOf(productionSlices("combination", noAssort)),
  "Size break-up not entered on Quantities ▸ Assort",
);
refute(
  "…and does NOT fall back to an even split",
  productionSlices("size", noAssort),
  [200, 200, 200],
);

// ---------------------------------------------------------------------------
// 6. Every refusal — a sentence, and never 0
// ---------------------------------------------------------------------------

const s600: ProductionSlice = {
  key: "",
  label: "Whole order",
  qty: 600,
  style_ref_no: null,
  combo: null,
  size_id: null,
};

for (const [label, l] of [
  ["per_pieces blank", line({ per_pieces: null })],
  ["per_pieces 0", line({ per_pieces: 0 })],
  ["per_pieces negative", line({ per_pieces: -1 })],
  ["per_pieces NaN", line({ per_pieces: Number.NaN })],
] as const) {
  check(`${label} refuses`, refusalOf(requirementFor(l, s600)), "Pieces must be more than 0");
  refute(`${label} is not 0`, requirementFor(l, s600), 0);
}

check(
  "no_of_items blank refuses",
  refusalOf(requirementFor(line({ no_of_items: null }), s600)),
  "Enter how many are used per piece",
);
check(
  "no_of_items 0 refuses — a blank grid row carries 0",
  refusalOf(requirementFor(line({ no_of_items: 0 }), s600)),
  "Enter how many are used per piece",
);
refute("no_of_items 0 is not 0", requirementFor(line({ no_of_items: 0 }), s600), 0);

check(
  "wastage over 100 refuses",
  refusalOf(requirementFor(line({ excess_pct: 120 }), s600)),
  "Wastage must be between 0 and 100",
);

check(
  "an unrecognised basis refuses rather than defaulting to 'order'",
  refusalOf(basisOf("Color-wise")),
  "Choose how this material splits",
);
check("a blank basis refuses", refusalOf(basisOf(null)), "Choose how this material splits");
check("'colour' resolves", basisOf(" Colour "), "colour");

check(
  "no approval rows refuses",
  refusalOf(productionSlices("order", order({ approvals: [] }))),
  "No production quantity yet — fill Approval Qty on the order",
);
check(
  "approval rows that are all blank refuse — distinct from having none",
  refusalOf(productionSlices("order", order({ approvals: [approval(0)] }))),
  "Approval Qty rows have no quantity",
);

// THE REJECTION RULE NO LONGER REACHES A MATERIAL (client 2026-08-20), so a gap
// in its tiers cannot block a BOM. This vector asserted the opposite — "a chosen
// rule with no tier for this quantity refuses" — and is inverted rather than
// deleted, because the refusal it guarded was a real safety net and its removal
// should be visible to whoever reads this file next.
//
// The gap still refuses where the allowance is actually used: `rejectionFor` and
// `productionTarget` are untouched, and the Approval Qty tab still shows a dash
// and says which case it is. What changed is only that a material requirement no
// longer waits on that answer.
const gapTiers: RejectionTier[] = [
  { from_value: 1, to_value: 100, rejection_allowance: 3, allowance_type: "flat" },
];
check(
  "a rejection-tier gap no longer blocks the BOM",
  refusalOf(
    productionSlices("order", order({ rejectionRuleChosen: true, tiers: gapTiers })),
  ),
  null,
);
check(
  "…and it plans the entered quantity regardless",
  required(
    "order",
    order({ rejectionRuleChosen: true, tiers: gapTiers }),
    line({ no_of_items: 1, per_pieces: 1 }),
  ),
  [{ label: "Whole order", value: 600 }],
);
check(
  "…while NO rule computes, which is what every existing order does",
  totalProductionOf(order({ rejectionRuleChosen: false, tiers: null })),
  600,
);

// Set disagreements poison the whole explosion.
check(
  "a combo with no Approval Qty row refuses and names it",
  refusalOf(
    productionSlices(
      "colour",
      order({
        approvals: [approval(300, "WHITE")],
        combos: [combo("WHITE"), combo("NAVY")],
      }),
    ),
  ),
  "Combo NAVY has no quantity on Approval Qty",
);
check(
  "a quantity for a combo the Combos tab dropped refuses and names it",
  refusalOf(
    productionSlices(
      "colour",
      order({
        approvals: [approval(300, "WHITE"), approval(200, "NAVY")],
        combos: [combo("WHITE")],
      }),
    ),
  ),
  "Combo NAVY is not on the Combos tab",
);
check(
  "colour basis with no combos at all refuses",
  refusalOf(productionSlices("colour", order({ combos: [] }))),
  "This order has no combos to split by",
);

// ---------------------------------------------------------------------------
// 7. MOQ is a rollup, not a per-row floor
// ---------------------------------------------------------------------------

const fiveRows = [20, 20, 20, 20, 20];
check("five colour rows of 20 total 100", moqRollup(fiveRows, 500, true), {
  total: 100,
  afterMoq: 500,
});
refute(
  "MOQ applied per row would have bought 2,500",
  (moqRollup(fiveRows, 500, true) as { afterMoq: number }).afterMoq,
  2500,
);
check("an MOQ below the requirement changes nothing", moqRollup([900], 500, true), {
  total: 900,
  afterMoq: 900,
});
check(
  "an MOQ with no purchase unit refuses — 500 of what?",
  refusalOf(moqRollup(fiveRows, 500, false)),
  "Set a purchase unit before an MOQ can be applied",
);

// ---------------------------------------------------------------------------
// 7b. Round To, and the ORDER it runs in against the MOQ (0437)
// ---------------------------------------------------------------------------

// The client's own example: an excess-calculated figure nobody orders.
check("567 rounded to the next 50 is 600", roundUpTo(567, 50), 600);
check("567 rounded to the next 100 is 600", roundUpTo(567, 100), 600);
check("a gross step — 567 buttons is 4 gross", roundUpTo(567, 144), 576);

// UP, NEVER TO NEAREST. 567 is nearer 550 than 600 on a step of 50, so a
// round-to-nearest implementation passes every example above except this one —
// which is exactly the buy-short failure the whole module rounds up to prevent.
refute("rounding is never to NEAREST", roundUpTo(567, 50), 550);

// AN ALREADY-ROUND FIGURE MUST STAY ITSELF. This is the `toFixed(6)` before the
// ceil, and without it 600/50 = 11.999999999999998 ceils to 12 and returns 650.
check("600 on a step of 50 is still 600", roundUpTo(600, 50), 600);
check("a fractional step does not drift", roundUpTo(1.2, 0.1), 1.2);

// NULL AND 0 ARE NOT ERRORS AND ARE NOT ROUNDING. `Math.ceil(x / 0)` is
// Infinity in JS rather than a throw, so an unguarded 0 escapes into the
// purchase figure as an ordinary-looking number.
check("no step asked for passes through", roundUpTo(567, null), 567);
check("a step of 0 passes through, never Infinity", roundUpTo(567, 0), 567);

// THE ORDER OF MOQ AND ROUND TO, which is the whole reason 0437 has a header.
// Round-then-MOQ would give 550 here; the client chose MOQ first.
check("MOQ lifts BEFORE the step rounds", lineQuantity([100], 550, 500, true), {
  calcQty: 100,
  excessCalcQty: 100,
  purchaseQty: 100,
  afterMoq: 550,
  finalQty: 1000,
});
refute(
  "rounding first would have bought 550, not 1,000",
  (lineQuantity([100], 550, 500, true) as { finalQty: number }).finalQty,
  550,
);

// The ordinary case: a step with no MOQ, and an MOQ with no step.
check("a step alone", lineQuantity([567], null, 50, true), {
  calcQty: 567,
  excessCalcQty: 567,
  purchaseQty: 567,
  afterMoq: 567,
  finalQty: 600,
});
check("an MOQ alone still behaves exactly as it did", lineQuantity([100], 500, null, true), {
  calcQty: 100,
  excessCalcQty: 100,
  purchaseQty: 100,
  afterMoq: 500,
  finalQty: 500,
});
check("neither: the chain is the requirement, untouched", lineQuantity([567], null, null, true), {
  calcQty: 567,
  excessCalcQty: 567,
  purchaseQty: 567,
  afterMoq: 567,
  finalQty: 567,
});

// A ROUNDING STEP NEEDS A UNIT for the reason an MOQ does — "round to 144" on a
// line with no unit is 144 of nothing.
check(
  "a step with no purchase unit refuses",
  refusalOf(lineQuantity([567], null, 50, false)),
  "Set a purchase unit before a rounding step can be applied",
);
// ...but a line asking for NO rounding is not made to answer for a unit it does
// not need. This is the branch that would cage every ordinary line if the guard
// were unconditional.
check("no step, no unit, no refusal", lineQuantity([567], null, null, false), {
  calcQty: 567,
  excessCalcQty: 567,
  purchaseQty: 567,
  afterMoq: 567,
  finalQty: 567,
});

// THE ROLLUP SURVIVES THE NEW STEP. Five colour rows of 20 round ONCE, at the
// line — rounding each row to the next 50 would buy 250 for an order needing
// 100, which is the per-row failure `moqRollup` was written against.
check("five colour rows round once, not five times", lineQuantity(fiveRows, null, 50, true), {
  calcQty: 100,
  excessCalcQty: 100,
  purchaseQty: 100,
  afterMoq: 100,
  finalQty: 100,
});
refute(
  "rounding per row would have bought 250",
  (lineQuantity(fiveRows, null, 50, true) as { finalQty: number }).finalQty,
  250,
);

// ---------------------------------------------------------------------------
// 8. Staleness — why a stored total is not enough
// ---------------------------------------------------------------------------

const before = order({
  approvals: [approval(300, "WHITE"), approval(200, "NAVY")],
  combos: [combo("WHITE"), combo("NAVY")],
});
const swapped = order({
  approvals: [approval(200, "WHITE"), approval(300, "NAVY")],
  combos: [combo("WHITE"), combo("NAVY")],
});

check("the swap leaves the total identical", [
  totalProductionOf(before),
  totalProductionOf(swapped),
], [500, 500]);
refute(
  "…but the fingerprint changes, which is the whole reason it exists",
  basisFingerprint(before),
  basisFingerprint(swapped),
);
check(
  "an unchanged order fingerprints the same",
  basisFingerprint(before),
  basisFingerprint(
    order({
      approvals: [approval(300, "WHITE"), approval(200, "NAVY")],
      combos: [combo("WHITE"), combo("NAVY")],
    }),
  ),
);
check(
  "row ORDER does not change the fingerprint — the grid is re-sortable",
  basisFingerprint(before),
  basisFingerprint(
    order({
      approvals: [approval(200, "NAVY"), approval(300, "WHITE")],
      combos: [combo("WHITE"), combo("NAVY")],
    }),
  ),
);
refute(
  "a new combo at qty 0 DOES change it — the explosion grows a row",
  basisFingerprint(before),
  basisFingerprint(
    order({
      approvals: [approval(300, "WHITE"), approval(200, "NAVY"), approval(0, "RED")],
      combos: [combo("WHITE"), combo("NAVY"), combo("RED")],
    }),
  ),
);
refute(
  "a REMOVAL changes it",
  basisFingerprint(before),
  basisFingerprint(order({ approvals: [approval(300, "WHITE")], combos: [combo("WHITE")] })),
);
// INVERTED ON 2026-08-20 WITH THE RULE IT MIRRORS. The fingerprint hashes what
// the requirement is computed FROM; the requirement stopped reading Excess %, so
// the hash had to stop reading it too. A hash that still moved with the excess
// would flag every document Recalculate for a change that cannot alter a single
// stored figure — the "trains the operator to ignore the badge" failure its own
// header warns about.
check(
  "the header Excess % no longer changes it — nothing downstream reads it",
  basisFingerprint(before),
  basisFingerprint(
    order({
      excessPct: 5,
      approvals: [approval(300, "WHITE"), approval(200, "NAVY")],
      combos: [combo("WHITE"), combo("NAVY")],
    }),
  ),
);

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CALCULATED QTY vs EXCESS CALCULATED QTY — two columns, not one
// (client 2026-08-20: "two fields not one — excess will user give, and
// calculated is based on no of pcs and no of item, with or without excess").
// ---------------------------------------------------------------------------

check(
  "base ignores the line's wastage",
  baseRequirementFor(line({ no_of_items: 2, per_pieces: 1, excess_pct: 3 }), s600),
  1200,
);
check(
  "with wastage the same line is higher",
  requirementFor(line({ no_of_items: 2, per_pieces: 1, excess_pct: 3 }), s600),
  1236,
);

// THE SHORTCUT THAT LOOKS RIGHT. Wastage is a plain multiplier, so dividing the
// AFTER figure back out reads as equivalent — and it un-rounds a number that was
// deliberately ceilinged. Built so the two disagree: 3 decimals, 3% wastage.
{
  const l = line({ no_of_items: 1, per_pieces: 7, excess_pct: 3, decimals: 3 });
  const after = requirementFor(l, s600) as number;
  const base = baseRequirementFor(l, s600) as number;
  refute(
    "base is NOT the after-figure divided by (1 + wastage) — that un-rounds the ceiling",
    base,
    Number((after / 1.03).toFixed(6)),
  );
}

// A wastage the line cannot honour refuses in BOTH columns. One answering while
// the other refuses reads as the before-figure being fine.
check(
  "an out-of-range wastage refuses the base column too",
  refusalOf(baseRequirementFor(line({ excess_pct: 120 }), s600)),
  "Wastage must be between 0 and 100",
);
check(
  "and a bad divisor refuses it as well",
  refusalOf(baseRequirementFor(line({ per_pieces: 0 }), s600)),
  "Pieces must be more than 0",
);

// The chain carries the split without touching the other three figures.
check(
  "calcQty is the base sum; MOQ and Round To apply only to the buying figure",
  lineQuantity([1236], 2000, 500, true, [1200]),
  { calcQty: 1200, excessCalcQty: 1236, purchaseQty: 1236, afterMoq: 2000, finalQty: 2000 },
);
refute(
  "an MOQ never lifts the CONSUMED figure",
  (lineQuantity([1236], 2000, 500, true, [1200]) as { calcQty: number }).calcQty,
  2000,
);
check(
  "with no wastage the two columns agree, and that is a real answer",
  lineQuantity([1200], null, null, true, [1200]),
  { calcQty: 1200, excessCalcQty: 1200, purchaseQty: 1200, afterMoq: 1200, finalQty: 1200 },
);
check(
  "a caller that does not ask for the split still gets a usable calcQty",
  (lineQuantity([567], null, 50, true) as { calcQty: number }).calcQty,
  567,
);


// ---------------------------------------------------------------------------
// 9. COUNTRY-WISE — the destination axis (client 2026-08-21)
//
// The production target is keyed (style, combo) and knows NOTHING about
// destinations. So a country slice cannot be read off the approval rows; it has
// to be APPORTIONED out of the order total using the Quantities tree's own
// weights, through the same `apportion` every other split uses. That is what
// keeps the cross-basis invariant true — country-wise must sum to exactly what
// order-wise gives, or two tabs disagree about one order.
// ---------------------------------------------------------------------------

const IN = "country-in";
const UK = "country-uk";
const COUNTRY_NAMES = { [IN]: "INDIA", [UK]: "UNITED KINGDOM" };

const destAssort = (size: string, qty: number, country: string) => ({
  style_ref_no: S1,
  combo: "WHITE",
  size_id: size,
  qty,
  country_id: country,
});

// 600 pieces, shipping 3:1 to the UK and India.
const twoCountries = order({
  approvals: [approval(600)],
  combos: [combo()],
  assortSizes: [destAssort(SZ_S, 3, UK), destAssort(SZ_M, 1, IN)],
  countryNames: COUNTRY_NAMES,
});

check(
  "country-wise gives one row per destination, apportioned 3:1",
  (productionSlices("country", twoCountries) as ProductionSlice[]).map((s) => [s.label, s.qty]),
  [
    ["UNITED KINGDOM", 450],
    ["INDIA", 150],
  ],
);
check(
  "the parts sum to exactly the order total",
  totalOf(required("country", twoCountries, line())),
  totalOf(required("order", twoCountries, line())),
);
check(
  "each slice names its country, so a requirement row can key on it",
  (productionSlices("country", twoCountries) as ProductionSlice[]).map((s) => s.country_id),
  [UK, IN],
);
check(
  "country slice keys are unique",
  new Set((productionSlices("country", twoCountries) as ProductionSlice[]).map((s) => s.key)).size,
  2,
);
// A destination with no weight POISONS the explosion rather than being dropped:
// two rows summing short reads exactly like a correct answer.
check(
  "a destination with no quantity is named, not skipped",
  refusalOf(
    productionSlices(
      "country",
      order({
        approvals: [approval(600)],
        combos: [combo()],
        assortSizes: [destAssort(SZ_S, 3, UK), destAssort(SZ_M, 0, IN)],
        countryNames: COUNTRY_NAMES,
      }),
    ),
  ),
  "INDIA has no quantity on Quantities",
);
check(
  "no destinations at all refuses, and says which tab",
  refusalOf(productionSlices("country", order({ assortSizes: [] }))),
  "No destinations on Quantities to split by",
);


// ---------------------------------------------------------------------------
// 10. THE PER-ROW SIZE-WISE TICK (0449)
//
// Legacy's sub-grid has a "Size wise" tick on each row, and the client confirmed
// the model it implies: the Attribute picks ONE axis and a row splits ITSELF.
// The two composite bases left the dropdown because the tick reproduces them —
//
//     Order  + every row ticked  ==  the old `size` basis
//     Colour + every row ticked  ==  the old `combination` basis
//
// SO THE VECTORS ASSERT EXACTLY THAT EQUIVALENCE. It is the strongest statement
// available: the tick is not a new arithmetic, it is the existing apportionment
// reached a different way — and if the two ever diverge, one of them is wrong.
// ---------------------------------------------------------------------------

const ALL = () => true;
const NONE = () => false;

const shape = (v: ReturnType<typeof productionSlices>) =>
  isRefusal(v) ? v.refused : v.map((s) => [s.label, s.qty, s.size_id ?? ""]);

check(
  "Order + every row ticked IS the old size basis",
  shape(productionSlices("order", threeWay, undefined, ALL)),
  shape(productionSlices("size", threeWay)),
);
check(
  "Colour + every row ticked IS the old combination basis",
  shape(productionSlices("colour", threeWay, undefined, ALL)),
  shape(productionSlices("combination", threeWay)),
);
check(
  "no tick leaves the primary rows exactly as they were",
  shape(productionSlices("colour", threeWay, undefined, NONE)),
  shape(productionSlices("colour", threeWay)),
);

// THE INVARIANT THE WHOLE ENGINE LEANS ON must survive the tick: however a line
// is split, it buys the same amount.
check(
  "a ticked split still totals what the order totals",
  totalOf(
    (productionSlices("colour", threeWay, undefined, ALL) as ProductionSlice[]).map((s) => ({
      label: s.label,
      value: requirementFor(line(), s),
    })),
  ),
  totalOf(required("order", threeWay, line())),
);

// ONE ROW TICKED, ONE NOT — the case neither old basis could express, and the
// reason the tick is per row rather than per line.
const oneTicked = productionSlices(
  "colour",
  threeWay,
  undefined,
  (s) => (s.combo ?? "") === "WHITE",
);
check(
  "a mixed tick splits only the row that asked",
  isRefusal(oneTicked) ? oneTicked.refused : oneTicked.filter((s) => !s.size_id).map((s) => s.label),
  ["NAVY"],
);
check(
  "…and the mixed split still totals the same",
  totalOf(
    (oneTicked as ProductionSlice[]).map((s) => ({ label: s.label, value: requirementFor(line(), s) })),
  ),
  totalOf(required("order", threeWay, line())),
);

// ---------------------------------------------------------------------------
// 14. The published test docket (2026-08-21)
//
// A roadmap asked for four vectors: the WHITE/NAVY targets, the 1:2:1 largest
// remainder split, the 2,719.2 precision case and MOQ-before-Round. THREE OF THE
// FOUR WERE ALREADY HERE and are deliberately not repeated - "600 / 7 rounds UP
// to 85.72" with its two refutes covers the precision case including the
// decimal_places trap, "the buyer's excess rounds per row" covers the target
// arithmetic, and `lineQuantity([100], 550, 500, true)` in section 11 is
// byte-identical to the MOQ-first ask. A suite that asserts one fact twice
// reports two passes for one guarantee, which is how a gap hides behind a green
// run.
//
// What follows is only the remainder.
// ---------------------------------------------------------------------------

/*
 * THE EXACT-HALF DOUBLE TIE, which 2:3:5 and 1:1:1 above cannot reach.
 *
 * 650 across 1:2:1 is 162.5 / 325 / 162.5 - TWO fractions of exactly .5, and the
 * rule rests on which of them takes the single leftover piece. 2:3:5 divides
 * evenly and never produces a remainder at all; 1:1:1 produces three EQUAL
 * fractions, where "ties go to the earlier index" and "ties go to the first
 * index" are the same answer. Here they are not - the tie is between the FIRST
 * and the THIRD - so an implementation breaking ties any other way lands on
 * [162, 325, 163] and still sums to 650.
 */
check("1:2:1 over 650 - the leftover goes to the EARLIER tie", apportion(650, [150, 300, 150]), [
  163, 325, 162,
]);
refute("...not ceil-per-share, which totals 651", apportion(650, [150, 300, 150]), [163, 325, 163]);
refute("...not floor-and-drop, which totals 649", apportion(650, [150, 300, 150]), [162, 325, 162]);
refute("...not the later tie", apportion(650, [150, 300, 150]), [162, 325, 163]);
check(
  "...and it sums to exactly the target, which is the point",
  apportion(650, [150, 300, 150]).reduce((a, b) => a + b, 0),
  650,
);

/*
 * THE DOCKET'S FIXTURE END TO END. Each half of this is asserted somewhere above;
 * what is NOT asserted anywhere is that they COMPOSE - two colourways, each
 * carrying its own excess and approval pieces, folding to targets that then agree
 * across every basis. The cross-basis invariant is the one this suite leans on
 * hardest and the one a new basis is most likely to break.
 */
const docket = order({
  excessPct: 5,
  approvals: [approval(600, "WHITE", S1, 20), approval(400, "NAVY", S1, 20)],
  combos: [combo("WHITE"), combo("NAVY")],
  assortSizes: [
    assort(SZ_S, 150, "WHITE"),
    assort(SZ_M, 300, "WHITE"),
    assort(SZ_L, 150, "WHITE"),
    assort(SZ_S, 100, "NAVY"),
    assort(SZ_M, 200, "NAVY"),
    assort(SZ_L, 100, "NAVY"),
  ],
});

check(
  "docket: 600+30+20 and 400+20+20 resolve to 650 and 440",
  (() => {
    const sl = productionSlices("colour", docket);
    return isRefusal(sl) ? sl.refused : sl.map((x) => [x.label, x.qty]);
  })(),
  [
    ["WHITE", 650],
    ["NAVY", 440],
  ],
);

check(
  "docket: the size split preserves each colourway's own curve",
  (() => {
    const sl = productionSlices("combination", docket);
    return isRefusal(sl) ? sl.refused : sl.map((x) => [x.label, x.qty]);
  })(),
  [
    ["WHITE · S", 163],
    ["WHITE · M", 325],
    ["WHITE · L", 162],
    ["NAVY · S", 110],
    ["NAVY · M", 220],
    ["NAVY · L", 110],
  ],
);

for (const basis of ["order", "style", "colour", "size", "combination"] as RequirementBasis[]) {
  const sl = productionSlices(basis, docket);
  check(
    `docket: ${basis} totals 1,090 like every other basis`,
    isRefusal(sl) ? sl.refused : sl.reduce((a, b) => a + b.qty, 0),
    1090,
  );
}

/*
 * THE DISPLAY, which had no vector at all and is where the bug actually was
 * (2026-08-21).
 *
 * `fmtNumber` is a bare `toLocaleString`: three fraction digits, rounded to
 * NEAREST. The engine ceilings to the UNIT's precision precisely so a requirement
 * is never understated, and the formatter handed that back at the last step - a
 * six-decimal MTR requirement of 85.714286 printed as "85.714". Silent, because
 * 85.714 is an ordinary-looking quantity. `fmtQty` reads the same
 * `decimal_places_allowed` through the same `uomPrecision` clamp, so a figure can
 * no longer be ceilinged to one precision and printed at another.
 */
check("fmtQty prints a 6-decimal unit in full", fmtQty(85.714286, 6), "85.714286");
refute("...not fmtNumber's three digits", fmtQty(85.714286, 6), "85.714");
check("fmtQty honours a 2-decimal unit", fmtQty(2719.2, 2), "2,719.2");
check("a 0-dp unit still clamps to 2, never to a whole number", fmtQty(2719.2, 0), "2,719.2");
check("no trailing zeroes on an exact figure", fmtQty(150, 3), "150");
check("null is a dash, never a zero", fmtQty(null, 2), "—");
refute("...and never the string zero", fmtQty(null, 2), "0");

// ---------------------------------------------------------------------------
// The Combination sheet: panels -> colours -> a minimum per cone (0436 · 0454)
// ---------------------------------------------------------------------------
/**
 * The client's own example, 2026-08-19: a navy body, red sleeves and a yellow
 * collar on one garment, where "a sleeve might use less thread than the front".
 *
 * EVERY VECTOR HERE WAS MADE TO FAIL FIRST. `check-module-groups.mts` records
 * why that is the standard and not a formality: an assertion nobody has seen
 * refuse is an assertion nobody knows is connected, and this file's own header
 * makes the same point about a check that inspects nothing and prints
 * "0 findings".
 */

const CMP_FRONT = "aaaaaaa1-0000-0000-0000-000000000001";
const CMP_SLEEVE = "aaaaaaa1-0000-0000-0000-000000000002";
const CMP_COLLAR = "aaaaaaa1-0000-0000-0000-000000000003";
const COL_NAVY = "bbbbbbb1-0000-0000-0000-000000000001";
const COL_RED = "bbbbbbb1-0000-0000-0000-000000000002";

console.log("\n§  colourSplits — panels arrive at a rate, colours survive it");

/* THE BOUNDARY 0423 AND 0436 BOTH ASSERT. You do not buy sleeve-thread and
   front-thread; you buy thread. So two panels of ONE colour collapse into one
   rate and the components are remembered only for the screen's summary. */
check(
  "two panels of one colour become ONE split",
  colourSplits(COL_NAVY, [
    { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1 },
    { component_id: CMP_SLEEVE, item_color_id: null, no_of_items: 12, per_pieces: 1 },
  ]),
  [
    {
      item_color_id: COL_NAVY,
      component_ids: [CMP_FRONT, CMP_SLEEVE],
      no_of_items: 37,
      per_pieces: 1,
    },
  ],
);

/* AND THE RATE IS SUMMED OVER ONE PIECE, so a split can be handed straight to
   `requirementFor` with `per_pieces: 1`. 2 per piece plus 1 per 2 pieces is 2.5
   per garment — the number a cone is bought against. */
check(
  "a divisor is folded in before the sum, not after",
  (
    colourSplits(COL_NAVY, [
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: 2, per_pieces: 1 },
      { component_id: CMP_SLEEVE, item_color_id: null, no_of_items: 1, per_pieces: 2 },
    ]) as { no_of_items: number }[]
  )[0].no_of_items,
  2.5,
);

check(
  "two colours are two splits — white thread and navy thread are two purchases",
  (
    colourSplits(COL_NAVY, [
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1 },
      { component_id: CMP_SLEEVE, item_color_id: COL_RED, no_of_items: 12, per_pieces: 1 },
    ]) as unknown[]
  ).length,
  2,
);

/* A BLANK PANEL COLOUR IS "THE LINE'S", NEVER "NO COLOUR" — the inherit
   contract 0436 gives the column, and the reason a blank panel merges with one
   that names the line's colour explicitly rather than standing apart. */
check(
  "a blank panel colour resolves to the line's",
  (
    colourSplits(COL_NAVY, [
      { component_id: CMP_COLLAR, item_color_id: null, no_of_items: 8, per_pieces: 1 },
    ]) as { item_color_id: string | null }[]
  )[0].item_color_id,
  COL_NAVY,
);

/* AN EMPTY ARRAY IS NOT A REFUSAL, and callers must not read it as one: a line
   with no panels is the ORDINARY line, and 0436 is opt-in per line precisely so
   that stays true. This is the vector that keeps every pre-0436 line unchanged. */
check("no panels is an empty list, not a refusal", colourSplits(COL_NAVY, []), []);
refute("...and emphatically not a refusal", isRefusal(colourSplits(COL_NAVY, [])), true);

/* A BAD PANEL POISONS THE LINE AND NAMES ITSELF. The panels SUM, so dropping a
   bad one yields a smaller rate that looks entirely reasonable — the partial
   explosion this module's header opens with. */
check(
  "a zero divisor refuses, naming the panel",
  refusalOf(
    colourSplits(COL_NAVY, [
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 0, label: "FRONT BODY" },
    ]),
  ),
  "FRONT BODY: pieces must be more than 0",
);
check(
  "a missing quantity refuses too",
  refusalOf(
    colourSplits(COL_NAVY, [
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: null, per_pieces: 1, label: "FRONT BODY" },
    ]),
  ),
  "FRONT BODY: enter how many are used",
);

console.log("\n§  panelConsumption — the override wins (client 2026-08-25)");

/*
 * THE PRECEDENCE, PINNED IN BOTH DIRECTIONS:
 *
 *     Tier 1 manual slice override > Tier 2 panel rate > Tier 3 line default
 *
 * These two vectors are the rule. They REPLACED a pair asserting the provisional
 * "panels win", changed in the same edit as the arithmetic — the comment that
 * stood here said "Change this vector WITH the rule, never after it", and a
 * vector left asserting a superseded rule is worse than none: it makes the old
 * behaviour look deliberate to everyone who runs the suite.
 */

/* TIER 2. No slice override, so the panels are the only ratio anyone entered. */
check(
  "with no override, the panel rate is the rate",
  panelConsumption(
    { no_of_items: 20, per_pieces: 1 },
    { no_of_items: 20, per_pieces: 1 },
    { item_color_id: COL_NAVY, component_ids: [CMP_FRONT], no_of_items: 37, per_pieces: 1 },
  ),
  { no_of_items: 37, per_pieces: 1 },
);

/* TIER 1. The override replaces the construction outright — not scaled against
   the panel rate, which was a live candidate and was rejected. */
check(
  "an override beats the panel rate",
  panelConsumption(
    { no_of_items: 24, per_pieces: 1 },
    { no_of_items: 20, per_pieces: 1 },
    { item_color_id: COL_NAVY, component_ids: [CMP_FRONT], no_of_items: 37, per_pieces: 1 },
  ),
  { no_of_items: 24, per_pieces: 1 },
);

/* AND IT IS NOT SCALED. The rejected rule stated outright, because a vector that
   only names the right answer cannot say which wrong one it was guarding
   against — 24/20 x 37 is 44.4, and 24 x 37 is 888. */
refute(
  "...and the panel rate is not multiplied into it",
  panelConsumption(
    { no_of_items: 24, per_pieces: 1 },
    { no_of_items: 20, per_pieces: 1 },
    { item_color_id: COL_NAVY, component_ids: [CMP_FRONT], no_of_items: 37, per_pieces: 1 },
  ).no_of_items,
  44.4,
);

/* THE OVERRIDE IS DETECTED BY COMPARISON WITH THE LINE, not by truthiness — a
   slice that inherited its figures is NOT an override, and a test for "is there
   a figure" would hand tier 1 to every slice on the line. */
check(
  "a slice that merely INHERITED the line is not an override",
  panelConsumption(
    { no_of_items: 20, per_pieces: 1 },
    { no_of_items: 20, per_pieces: 1 },
    { item_color_id: COL_NAVY, component_ids: [CMP_FRONT], no_of_items: 9, per_pieces: 1 },
  ).no_of_items,
  9,
);

/* PER FIELD, WHICH IS WHY IT TAKES A COMPOSED VALUE. An operator who typed only
   `no_of_items` keeps the LINE's `per_pieces` — "more zippers, same per-piece" —
   so tier 1 hands back 24/10, never 24/1 and never a null divisor. */
check(
  "a half-typed override keeps the line's divisor",
  panelConsumption(
    { no_of_items: 24, per_pieces: 10 },
    { no_of_items: 20, per_pieces: 10 },
    { item_color_id: COL_NAVY, component_ids: [CMP_FRONT], no_of_items: 37, per_pieces: 1 },
  ),
  { no_of_items: 24, per_pieces: 10 },
);

/*
 * THE SPLIT SURVIVES THE OVERRIDE — the question that had to be answered before
 * the rule could be implemented at all.
 *
 * Panels do two jobs: they supply a ratio, and they divide the line into one row
 * per TRIM COLOUR (`colourSplits`), which is what feeds `item_color_id`, the
 * per-cone MOQ grouping, the PO ceiling and the grey->DC->dyed path. Only the
 * first is this function's. It returns two numbers and cannot remove a row,
 * merge two colours or change what is bought — so "replace the construction"
 * reaches the rate and stops there. Asserted by handing the SAME override two
 * different colour splits and getting two answers back.
 */
const twoTrimColours = [
  { item_color_id: COL_NAVY, component_ids: [CMP_FRONT], no_of_items: 37, per_pieces: 1 as const },
  { item_color_id: COL_RED, component_ids: [CMP_SLEEVE], no_of_items: 12, per_pieces: 1 as const },
];
check(
  "an override does not collapse a two-colour line to one row",
  twoTrimColours.map(
    (s) => panelConsumption({ no_of_items: 24, per_pieces: 1 }, { no_of_items: 20, per_pieces: 1 }, s).no_of_items,
  ).length,
  2,
);

/*
 * SAME RATE EVERY COLOUR — CHOSEN, NOT INHERITED (client 2026-08-25).
 *
 * `sliceKey` has no colour axis (combo/size/country/combination/style), so one
 * override cannot say "navy 3, red 1". Under tier 1 the same overridden rate
 * therefore reaches EVERY trim colour and the line's total multiplies by the
 * colour count. **This was put to the client WITH the multiplication visible and
 * chosen deliberately**, against their own worked example:
 *
 *     Line 2/pc, WHITE 300 / NAVY 200, operator types 4/pc.
 *     WHITE -> 4/pc -> 1,200 ; NAVY -> 4/pc -> 800 ; TOTAL 2,000.
 *     One figure typed, both colours moved.
 *
 * It was raised here first as an open consequence and this vector said so. It is
 * now a decision, and the label had to change with it: a vector describing itself
 * as an unanswered question invites the next reader to "fix" the multiplication
 * as an oversight, which is the same failure mode as a vector left asserting a
 * superseded rule.
 *
 * ## THE READING THAT WON, AND THE TWO THAT LOST
 *
 * An override means **"this line's RATE is wrong, fix it"** — not "this COLOUR
 * needs more". Both alternatives were live:
 *
 *   - *per-colour override* — add a colour axis to `sliceKey` so an override
 *     binds to one trim colour. Rejected as a SCHEMA AND UI change rather than an
 *     arithmetic one: a new axis, the unique index, and new grid cells.
 *   - *refuse on multi-colour lines* until per-colour exists. Rejected because it
 *     blocks a planner who has a legitimate whole-line correction to make.
 */
check(
  "one override reaches every trim colour — the client's chosen rule",
  twoTrimColours.map(
    (s) => panelConsumption({ no_of_items: 24, per_pieces: 1 }, { no_of_items: 20, per_pieces: 1 }, s).no_of_items,
  ),
  [24, 24],
);

/* AND IT IS NOT APPORTIONED ACROSS THE COLOURS — the rejected per-colour reading
   stated outright, in the idiom the `refute` above uses for the rejected scale
   answer. Splitting 24 between navy and red would look like restraint and would
   under-buy the line by half; the client chose the whole rate on each. */
refute(
  "...and is NOT divided between them",
  twoTrimColours.map(
    (s) => panelConsumption({ no_of_items: 24, per_pieces: 1 }, { no_of_items: 20, per_pieces: 1 }, s).no_of_items,
  ),
  [12, 12],
);

console.log("\n§  colourSplits — one panel counted twice is not two panels");

/*
 * THE SUM'S PREMISE, ASSERTED. `colourSplits` adds panels together because front
 * body plus sleeves is one thread rate — which is only true while each row is a
 * DISTINCT panel. The same panel handed in twice used to double the rate
 * silently: no crash, no dash, just a figure that reads reasonably and buys
 * twice what the order needs.
 *
 * It is reachable and nothing else catches it. The components table carries no
 * unique key over (item_line_id, component_id, item_color_id) — checked against
 * the live catalogue — and the screen's surviving caller synthesises the list
 * one entry per (part x production slice), so a two-part line over two
 * colourways hands FRONT in twice.
 */
check(
  "the same panel twice in one colour refuses, naming it",
  refusalOf(
    colourSplits(COL_NAVY, [
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1, label: "TOP" },
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1, label: "TOP" },
    ]),
  ),
  "TOP: listed twice for one colour — enter each panel once",
);

/* AND IT REFUSES RATHER THAN DOUBLING — the wrong answer this guards against
   stated outright, because a vector that only names the refusal cannot say what
   it was standing in the way of. */
refute(
  "...rather than summing to a doubled rate",
  colourSplits(COL_NAVY, [
    { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1, label: "TOP" },
    { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1, label: "TOP" },
  ]),
  [
    {
      item_color_id: COL_NAVY,
      component_ids: [CMP_FRONT, CMP_FRONT],
      no_of_items: 50,
      per_pieces: 1,
    },
  ],
);

/* THE IDENTITY IS THE PAIR, NOT THE PANEL. A front body stitched in navy and
   topstitched in red is TWO things to buy — 0436's own case — so this must go on
   answering. The guard would be worse than useless if it refused it: the
   operator would have a correct sheet with no way to enter it. */
check(
  "the same panel in two colours is still two splits",
  (
    colourSplits(COL_NAVY, [
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1 },
      { component_id: CMP_FRONT, item_color_id: COL_RED, no_of_items: 4, per_pieces: 1 },
    ]) as unknown[]
  ).length,
  2,
);

/* A BLANK PANEL COLOUR RESOLVES TO THE LINE'S BEFORE THE PAIR IS FORMED, so a
   row naming the line's colour explicitly and one leaving it blank are the same
   panel and collide. Testing the raw column instead would let exactly that pair
   through — the inherit contract 0436 gives the column, read from the guard's
   side. */
check(
  "a blank colour and the line's own colour are the SAME pair",
  refusalOf(
    colourSplits(COL_NAVY, [
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1, label: "FRONT BODY" },
      { component_id: CMP_FRONT, item_color_id: COL_NAVY, no_of_items: 25, per_pieces: 1, label: "FRONT BODY" },
    ]),
  ),
  "FRONT BODY: listed twice for one colour — enter each panel once",
);

/* THE ORDINARY SHEET IS UNTOUCHED. Every 0436 line that was correct before this
   guard existed has to stay correct, or the guard has bought a doubled rate at
   the price of a working feature. */
check(
  "two DIFFERENT panels of one colour still sum, as they always did",
  (
    colourSplits(COL_NAVY, [
      { component_id: CMP_FRONT, item_color_id: null, no_of_items: 25, per_pieces: 1 },
      { component_id: CMP_SLEEVE, item_color_id: null, no_of_items: 12, per_pieces: 1 },
    ]) as { no_of_items: number }[]
  )[0].no_of_items,
  37,
);

console.log("\n§  lineQuantityByColour — the minimum is a minimum per CONE");

/* THE PROPERTY EVERY PRE-0436 LINE DEPENDS ON. One group must reduce to
   `lineQuantity` exactly, or this is a second MOQ rule standing beside the
   first rather than the first with its grouping made explicit. */
const oneGroup = lineQuantityByColour(
  [{ item_color_id: null, quantities: [100], baseQuantities: [90] }],
  550,
  500,
  true,
);
check("one group reduces to lineQuantity, to the digit", oneGroup, lineQuantity([100], 550, 500, true, [90]));
check("...and that answer is still MOQ-then-step", oneGroup, {
  calcQty: 90,
  excessCalcQty: 100,
  purchaseQty: 100,
  afterMoq: 550,
  finalQty: 1000,
});

/* THE CLIENT'S CASE, 2026-08-22. Navy and red are different SKUs, so an MOQ of
   500 has to be cleared TWICE. The old rollup answered 500 for this, and a
   purchase order written for the honest 1,000 would have been refused by the
   ceiling — a control firing on correct work. */
const twoColours = lineQuantityByColour(
  [
    { item_color_id: COL_NAVY, quantities: [100] },
    { item_color_id: COL_RED, quantities: [100] },
  ],
  500,
  null,
  true,
);
check("two colours clear the minimum separately", twoColours, {
  calcQty: 200,
  excessCalcQty: 200,
  purchaseQty: 200,
  afterMoq: 1000,
  finalQty: 1000,
});
refute(
  "...NOT one rollup over the pair, which buys 500 of two things",
  (twoColours as { finalQty: number }).finalQty,
  500,
);
/* AND THE CONSUMPTION COLUMNS DO NOT MOVE. They are what the order CONSUMES,
   and consumption does not care that a supplier has a minimum — the separation
   the four columns exist to keep. */
check(
  "the minimum does not touch what the order consumes",
  (twoColours as { excessCalcQty: number }).excessCalcQty,
  200,
);

/* THE STEP GROUPS THE SAME WAY. Rounding the pair once would leave one colour
   short of an orderable figure, which is the whole reason a step exists. */
check(
  "the rounding step applies per colour too",
  (
    lineQuantityByColour(
      [
        { item_color_id: COL_NAVY, quantities: [120] },
        { item_color_id: COL_RED, quantities: [130] },
      ],
      null,
      50,
      true,
    ) as { finalQty: number }
  ).finalQty,
  300,
);
refute(
  "...not one rounding of the sum, which is 250",
  (
    lineQuantityByColour(
      [
        { item_color_id: COL_NAVY, quantities: [120] },
        { item_color_id: COL_RED, quantities: [130] },
      ],
      null,
      50,
      true,
    ) as { finalQty: number }
  ).finalQty,
  250,
);

/* A REFUSED COLOUR POISONS THE LINE. Answering for navy and dropping red totals
   less than the order needs and looks exactly like a correct answer. */
check(
  "one refused colour refuses the whole line",
  refusalOf(
    lineQuantityByColour(
      [
        { item_color_id: COL_NAVY, quantities: [100] },
        { item_color_id: COL_RED, quantities: [null] },
      ],
      null,
      null,
      true,
    ),
  ),
  "Nothing to total — every line refused",
);
refute(
  "...it does NOT quietly answer 100",
  (lineQuantityByColour(
    [
      { item_color_id: COL_NAVY, quantities: [100] },
      { item_color_id: COL_RED, quantities: [null] },
    ],
    null,
    null,
    true,
  ) as { finalQty?: number }).finalQty,
  100,
);

/* NO GROUPS IS UNANSWERABLE, NOT ZERO. 0 reads as "none needed", the one answer
   this module never intends, and this figure is the one a purchase is written
   from. */
check(
  "no groups refuses rather than totalling 0",
  refusalOf(lineQuantityByColour([], 500, null, true)),
  "Nothing to total — every line refused",
);

/* THE UNIT RULE SURVIVES THE GROUPING. "500" with no unit is 500 of nothing —
   the blank-supply-type shape the nominated-vendor rule refuses. */
check(
  "an MOQ with no unit still refuses, per group",
  refusalOf(
    lineQuantityByColour([{ item_color_id: COL_NAVY, quantities: [100] }], 500, null, false),
  ),
  "Set a purchase unit before an MOQ can be applied",
);

// ---------------------------------------------------------------------------
// 15. THE MINIMUM AND THE STEP ARE PURCHASE FACTS — the unit they run in
// ---------------------------------------------------------------------------
/*
 * THE DEFECT THESE EXIST TO CATCH, and why every MOQ vector above missed it.
 *
 * Sections 7 and 7b pass `unitKnown` as a BARE BOOLEAN. That asks "is there a
 * unit?" and never "which one?", so the whole suite was blind to a `moq` of
 * 5000 being compared against 20,000 MTR on the grid while
 * `bomCeilingForOrder` compared that same 5000 against the 8 CONE those metres
 * convert to. One stored number, two units: the grid reported the minimum as
 * inert while the ceiling lifted the plan to 5,000 cones — 12,500,000 MTR, and
 * an over-purchase control that no longer fires.
 *
 * 0437 titles itself "a Material BOM line can round its PURCHASE figure UP" and
 * 0451 states it outright: "a minimum and a rounding step are properties of the
 * PURCHASE". These vectors are that sentence, executable.
 *
 * VERIFIED BY BEING MADE TO FAIL FIRST against the pre-fix engine — the rule
 * this repo applies to every new assertion. Without `purchaseQuantities` the
 * first check below returns 20,000 where it now returns 12.
 */

/** The header example of `lib/uom/convert.ts`: one cone holds 2,500 metres. */
const CONE = { alt_qty: 1, alt_uom_id: "cone", base_qty: 2500, base_uom_id: "mtr" };
/** Entered per dozen, the SAME pack — the pair form is what makes that legal. */
const CONE_DOZEN = { alt_qty: 12, alt_uom_id: "cone", base_qty: 30000, base_uom_id: "mtr" };
/** 144 pieces to the gross — the second worked example in that header. */
const GROSS = { alt_qty: 1, alt_uom_id: "grs", base_qty: 144, base_uom_id: "nos" };

check("20,000 MTR on a 2,500 MTR cone is 8 cones", toPurchaseSlices([20000], CONE, 2), [8]);
check(
  "the same pack entered per dozen converts identically",
  toPurchaseSlices([20000], CONE_DOZEN, 2),
  [8],
);
check(
  "a null slice stays null rather than becoming 0",
  toPurchaseSlices([20000, null], CONE, 2),
  [8, null],
);
check(
  "no pack declared passes the consumption figures straight through",
  toPurchaseSlices([20000], null, 2),
  [20000],
);
check(
  "a half-typed conversion is not a conversion",
  toPurchaseSlices(
    [20000],
    { alt_qty: null, alt_uom_id: "cone", base_qty: 2500, base_uom_id: "mtr" },
    2,
  ),
  [20000],
);

/* THE ONE THAT WOULD HAVE CAUGHT IT. An MOQ of 12 against a line needing 8
   cones binds; against the 20,000 metres those cones hold it is inert. */
check(
  "an MOQ of 12 is 12 CONES, not 12 metres",
  lineQuantity([20000], 12, null, true, undefined, toPurchaseSlices([20000], CONE, 2)),
  { calcQty: 20000, excessCalcQty: 20000, purchaseQty: 8, afterMoq: 12, finalQty: 12 },
);
refute(
  "the pre-fix engine returned the metres untouched",
  (
    lineQuantity([20000], 12, null, true, undefined, toPurchaseSlices([20000], CONE, 2)) as {
      finalQty: number;
    }
  ).finalQty,
  20000,
);

/* THE CLIENT'S OWN LOOPHOLE FIGURE — a minimum typed while reading a grid that
   showed metres, then read by the ceiling as cones. Both sides now say 5,000
   cones, which is at least ONE answer rather than two. */
check(
  "an MOQ of 5,000 against 8 cones lifts to 5,000 CONES on both sides",
  (
    lineQuantity([20000], 5000, null, true, undefined, toPurchaseSlices([20000], CONE, 2)) as {
      finalQty: number;
    }
  ).finalQty,
  5000,
);

/* THE CONSUMPTION PAIR DOES NOT MOVE. `calcQty` and `excessCalcQty` are what the
   order CONSUMES and stay in metres — the separation `lineQuantity` already
   states for `baseQuantities`, now one column further along. */
check(
  "the first two columns stay in the consumption unit",
  (
    lineQuantity([20000], 5000, null, true, [19000], toPurchaseSlices([20000], CONE, 2)) as {
      calcQty: number;
    }
  ).calcQty,
  19000,
);

/* MOQ FIRST, THEN THE STEP — 0437's order, now asserted IN THE PURCHASE UNIT
   where it actually runs. 8 cones, minimum 10, rounded to the next 12. */
check(
  "MOQ then step, both in cones",
  lineQuantity([20000], 10, 12, true, undefined, toPurchaseSlices([20000], CONE, 2)),
  { calcQty: 20000, excessCalcQty: 20000, purchaseQty: 8, afterMoq: 10, finalQty: 12 },
);
refute(
  "step-then-MOQ would have reached 12 by the other route",
  (
    lineQuantity([20000], 10, 12, true, undefined, toPurchaseSlices([20000], CONE, 2)) as {
      afterMoq: number;
    }
  ).afterMoq,
  12,
);

/* PER SLICE, THEN SUMMED — the order `bomCeilingForOrder` sums the stored
   `purchase_qty` rows in. Converting the TOTAL instead is more accurate and
   DISAGREES with the ceiling, which is the whole failure being closed: 2,400
   NOS is 16.67 GRS, and three such slices are 50.01 rather than 50. */
check(
  "three slices convert individually, exactly as the ceiling sums them",
  toPurchaseSlices([2400, 2400, 2400], GROSS, 2),
  [16.67, 16.67, 16.67],
);
/* ROUNDED TO READ IT, and that is deliberate rather than a weaker assertion.
   16.67 x 3 is 50.010000000000005 in binary floating point — the artefact
   `ceilToPrecision` and `money()` both record — and `bomCeilingForOrder` sums
   the stored rows with the SAME raw `+`, so both sides carry the same noise and
   still agree to the digit. Smoothing it on one side only is how they would
   come to disagree by 5e-15, which is this whole file's failure in miniature.
   `fmtQty` absorbs it for the operator at the unit's own precision. */
check(
  "and the line total is their sum, not the conversion of the sum",
  Number(
    (
      lineQuantity(
        [7200],
        null,
        null,
        true,
        undefined,
        toPurchaseSlices([2400, 2400, 2400], GROSS, 2),
      ) as { purchaseQty: number }
    ).purchaseQty.toFixed(2),
  ),
  50.01,
);
refute(
  "converting the total would have produced 50 and disagreed with the ceiling",
  Number(
    (
      lineQuantity([7200], null, null, true, undefined, toPurchaseSlices([7200], GROSS, 2)) as {
        purchaseQty: number;
      }
    ).purchaseQty.toFixed(2),
  ),
  50.01,
);

/* THE CLIENT CHOSE EXACT DECIMALS OVER WHOLE PACKS — 16.67 GRS, never 17. A
   rounding step is how an operator asks for whole ones, and it is opt-in. */
check(
  "2,400 buttons is 16.67 gross and stays 16.67",
  (
    lineQuantity([2400], null, null, true, undefined, toPurchaseSlices([2400], GROSS, 2)) as {
      finalQty: number;
    }
  ).finalQty,
  16.67,
);
check(
  "a step of 1 is how whole gross are asked for",
  (
    lineQuantity([2400], null, 1, true, undefined, toPurchaseSlices([2400], GROSS, 2)) as {
      finalQty: number;
    }
  ).finalQty,
  17,
);

/* PER TRIM COLOUR, IN THE PURCHASE UNIT. Navy and red each clear the minimum on
   their own (client 2026-08-22) — and each clears it in cones. */
const twoConeColours = (moq: number) =>
  lineQuantityByColour(
    [
      {
        item_color_id: COL_NAVY,
        quantities: [5000],
        purchaseQuantities: toPurchaseSlices([5000], CONE, 2),
      },
      {
        item_color_id: COL_RED,
        quantities: [5000],
        purchaseQuantities: toPurchaseSlices([5000], CONE, 2),
      },
    ],
    moq,
    null,
    true,
  ) as { finalQty: number; excessCalcQty: number; purchaseQty: number };

check("two trim colours clear a cone minimum separately", twoConeColours(10).finalQty, 20);
refute(
  "rolled up first they would have shared one minimum",
  twoConeColours(10).finalQty,
  10,
);
check(
  "and the consumption total is still the metres both consume",
  twoConeColours(10).excessCalcQty,
  10000,
);

// ---------------------------------------------------------------------------
// WHICH PACK A LINE BUYS IN — `resolveLinePack`
// ---------------------------------------------------------------------------
//
// The Purchase Pack cell came off the item grid on 2026-08-21, so no line
// created since can NAME a pack, and the purchase figure it feeds was dead on
// every one of them: the Final Quantity showed the consumption figure instead
// (client 2026-08-27). The resolution moved to the line's own units, and these
// vectors exist because that number is SPENT — it is stored as `purchase_qty`
// and `bomCeilingForOrder` caps a purchase order against it.
//
// The vector that earns its place is the AMBIGUOUS one. The live data has a
// sewing thread at both 1 U_CONE = 2500 MTR and 1 U_CONE = 5000 MTR, so "find the
// conversion for this unit pair" and "find THE conversion for this unit pair"
// are two implementations that agree everywhere except there — and where they
// disagree, one of them buys twice what the order needs.

const THREAD = "item-thread";
const BUTTON = "item-button";
const MTR = "uom-mtr";
const U_CONE = "uom-cone";
const NOS = "uom-nos";
const U_GROSS = "uom-gross";

const pk = (over: Partial<PackRow> & { id: string }): PackRow => ({
  item_id: THREAD,
  alt_qty: 1,
  alt_uom_id: U_CONE,
  base_qty: 2500,
  base_uom_id: MTR,
  ...over,
});

/** The two real cone sizes of one thread, plus another material's gross. */
const PACKS: PackRow[] = [
  pk({ id: "cone-2500" }),
  pk({ id: "cone-5000", base_qty: 5000 }),
  pk({ id: "gross-144", item_id: BUTTON, alt_uom_id: U_GROSS, base_qty: 144, base_uom_id: NOS }),
];

const bomLine = (over: Partial<Parameters<typeof resolveLinePack>[0]> = {}) => ({
  item_id: BUTTON,
  purchase_uom_id: U_GROSS,
  consumption_uom_id: NOS,
  uom_conversion_id: null,
  ...over,
});

// ONE MATCH RESOLVES. This is the whole fix: the line names no pack and gets one.
const oneMatch = resolveLinePack(bomLine(), PACKS);
check("one matching pack resolves from the line's own units", oneMatch.pack?.id, "gross-144");
check("and it is usable", oneMatch.usable, true);
check("with no tie to break", oneMatch.choices.length, 0);

// TWO MATCHES RESOLVE TO NOTHING. Neither is guessed at.
const tie = resolveLinePack(
  bomLine({ item_id: THREAD, purchase_uom_id: U_CONE, consumption_uom_id: MTR }),
  PACKS,
);
check("two pack sizes of one unit resolve to no pack", tie.pack, null);
check("and are not usable", tie.usable, false);
check("both are offered as the tie to break", tie.choices.length, 2);
refute("the first is not silently taken", tie.pack, PACKS[0]);

// THE TIE, BROKEN. Naming one is what the exception cell on the screen writes.
const broken = resolveLinePack(
  bomLine({
    item_id: THREAD,
    purchase_uom_id: U_CONE,
    consumption_uom_id: MTR,
    uom_conversion_id: "cone-5000",
  }),
  PACKS,
);
check("a named pack resolves the tie", broken.pack?.id, "cone-5000");
check("and stops offering a choice", broken.choices.length, 0);

// A STORED PACK IS NEVER RE-DERIVED OVER. A BOM saved before 2026-08-21 chose by
// hand; re-resolving would move a purchase quantity on a document nobody edited.
check(
  "a stored pack wins over what the units would say",
  resolveLinePack(bomLine({ uom_conversion_id: "cone-2500" }), PACKS).pack?.id,
  "cone-2500",
);

// ANOTHER MATERIAL'S PACK IS NOT THIS LINE'S. `item_id` is half the match, and
// without it a gross of buttons would convert a thread.
check(
  "a conversion belonging to another material is ignored",
  resolveLinePack(bomLine({ item_id: "item-elastic" }), PACKS).pack,
  null,
);

// THE PACK MUST CONVERT INTO THE CONSUMED UNIT. A cone of metres against a line
// counted in pieces yields a number and a category error.
check(
  "a pack whose base is not the consumption unit is ignored",
  resolveLinePack(
    bomLine({ item_id: THREAD, purchase_uom_id: U_CONE, consumption_uom_id: NOS }),
    PACKS,
  ).pack,
  null,
);

// NO PURCHASE UNIT, NO HOP TO MAKE.
check(
  "a line with no purchase unit resolves nothing",
  resolveLinePack(bomLine({ purchase_uom_id: null }), PACKS).pack,
  null,
);

// A HALF-TYPED CONVERSION IS INERT, not "helpfully" completed — the same rule
// `conversionFactor` states for a row being typed.
check(
  "a conversion with no alt_qty is not a candidate",
  resolveLinePack(bomLine(), [pk({ id: "half", item_id: BUTTON, alt_uom_id: U_GROSS, base_uom_id: NOS, alt_qty: null })])
    .pack,
  null,
);

// A DERIVED PACK AND A NAMED ONE PRODUCE THE SAME FIGURE. That is the property
// that matters: the screen resolves and the server resolves, and `purchase_qty`
// is stored from one while the operator reads the other. (The arithmetic itself
// is asserted above — `toPurchaseQty` ROUNDS to the unit's decimals rather than
// ceilinging, the client's "16.67 Gross, not 17".)
check(
  "a derived pack buys exactly what the same pack named by hand buys",
  toPurchaseSlices([2400], oneMatch.pack!, 2),
  toPurchaseSlices(
    [2400],
    resolveLinePack(bomLine({ uom_conversion_id: "gross-144" }), PACKS).pack!,
    2,
  ),
);

console.log(failed === 0 ? "\nAll BOM requirement vectors pass." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
