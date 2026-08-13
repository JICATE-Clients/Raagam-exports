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
  productionSlices,
  requirementFor,
  totalProductionOf,
  type ApprovalRow,
  type AssortSizeRow,
  type BomLineInput,
  type ComboRow,
  type OrderProductionInput,
  type ProductionSlice,
  type RequirementBasis,
} from "../lib/orders/material-bom/requirement.ts";
import type { RejectionTier } from "../lib/masters/rejection-rule.ts";

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
    sizeName: (id) => SIZE_NAMES[id] ?? id,
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
// The MATERIAL excess must not be applied to the PIECES. Doing so would compound
// it with the order's own Excess %, which is already inside the target.
refute(
  "…and 3% is not compounded onto an order that already carries excess",
  required(
    "order",
    order({ excessPct: 5 }),
    line({ no_of_items: 1, per_pieces: 1, excess_pct: 3 }),
  ),
  [{ label: "Whole order", value: 618 }],
);

// ---------------------------------------------------------------------------
// 3. The target is the PRODUCTION target, not the PO quantity
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

check("production target = 600 + 30 + 10 + 30 = 670", totalProductionOf(richOrder), 670);
check(
  "2 labels against the TARGET = 1,340",
  required("order", richOrder, line()),
  [{ label: "Whole order", value: 1340 }],
);
refute(
  "not 1,200 — an engine reading po_qty passes every vector above this one",
  required("order", richOrder, line()),
  [{ label: "Whole order", value: 1200 }],
);

// ---------------------------------------------------------------------------
// 4. The cross-basis invariant — the strongest vector in the file
// ---------------------------------------------------------------------------

// 301 and 199, NOT 300 and 200. Both round 5% evenly, so an engine that summed
// the quantities FIRST and took excess once would agree with a per-line sum and
// the invariant below would prove nothing. 301 -> +16 and 199 -> +10 gives 526,
// where the summed route gives 525.
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
const byColour = totalOf(required("colour", threeWay, line()));
const bySize = totalOf(required("size", threeWay, line()));
const byCombo = totalOf(required("combination", threeWay, line()));

check(
  "order / colour / size / combination totals all agree",
  [byOrder, byColour, bySize, byCombo],
  [byOrder, byOrder, byOrder, byOrder],
);
check("and the figure is 2 x (317 + 209)", byOrder, 1052);
refute("not 2 x 525 — that is excess taken once on the summed quantity", byOrder, 1050);

// A count vector passes against a broken bucket key — assert who got NAMED.
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
// Each size row is exactly its column of the matrix — M is WHITE-M + NAVY-M.
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

// The pair that matters most: a rule NAMED whose tiers leave a gap must refuse,
// while no rule at all is a legitimate zero buffer.
const gapTiers: RejectionTier[] = [
  { from_value: 1, to_value: 100, rejection_allowance: 3, allowance_type: "flat" },
];
check(
  "a chosen rule with no tier for this quantity refuses",
  refusalOf(
    productionSlices("order", order({ rejectionRuleChosen: true, tiers: gapTiers })),
  ),
  "Rejection rule has no tier for 600 pieces — fix the rule or clear it on the order",
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
refute(
  "the header Excess % changes it, by construction",
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

console.log(failed === 0 ? "\nAll BOM requirement vectors pass." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
