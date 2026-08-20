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
  lineQuantity,
  productionSlices,
  baseRequirementFor,
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
// The ORDER's own Excess % never reaches a material. It did not before
// 2026-08-20 either — it was inside the target then, and the target is gone now
// — so the material's 3% still stands alone whatever the order carries.
check(
  "the order's Excess % does not move a material requirement",
  required(
    "order",
    order({ excessPct: 5 }),
    line({ no_of_items: 1, per_pieces: 1, excess_pct: 3 }),
  ),
  [{ label: "Whole order", value: 618 }],
);

// ---------------------------------------------------------------------------
// 3. The BOM plans against the ENTERED quantity (client 2026-08-20)
//
// THIS SECTION ASSERTED THE OPPOSITE UNTIL 2026-08-20, and the reversal is the
// point of keeping it. It used to read "the target is the PRODUCTION target, not
// the PO quantity" and carried a refutation — "not 1,200 — an engine reading
// po_qty passes every vector above this one" — written specifically to catch an
// engine that did what this one now does on purpose.
//
// So the refutation is inverted rather than deleted: 1,200 is the answer, and
// 1,340 is what a re-introduced production target would produce. Whoever changes
// this back will fail the vector below and read this note, which is the whole
// reason it is phrased as a pair.
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

// `totalProductionOf` is the BOM's OWN view of the order, so it moved with the
// rule: 600 entered, where it read 670 (600 + 30 excess + 10 approval + 30
// rejection) until 2026-08-20. `productionTarget` in `approval-qty.ts` still
// computes 670 and the Approval Qty tab still shows it — the two are now
// deliberately different numbers.
check("the BOM's view of the order is the 600 entered", totalProductionOf(richOrder), 600);
refute("not 670, which is what the ORDER's target still says", totalProductionOf(richOrder), 670);
check(
  "2 labels against the ENTERED quantity = 1,200",
  required("order", richOrder, line()),
  [{ label: "Whole order", value: 1200 }],
);
refute(
  "not 1,340 — that is the production target, which the BOM stopped reading on 2026-08-20",
  required("order", richOrder, line()),
  [{ label: "Whole order", value: 1340 }],
);
// The buffers are visibly absent, one at a time, so a partial restoration cannot
// pass: an engine that put back the excess but not the approval pieces would
// answer 1,260 here.
refute("no excess in it", required("order", richOrder, line()), [
  { label: "Whole order", value: 1260 },
]);
refute("no approval pieces in it", required("order", richOrder, line()), [
  { label: "Whole order", value: 1220 },
]);

// ---------------------------------------------------------------------------
// 4. The cross-basis invariant — the strongest vector in the file
// ---------------------------------------------------------------------------

// 301 and 199, NOT 300 and 200. The pair was chosen when the excess was still in
// the target (301 -> +16 and 199 -> +10 gives 526 against a summed 525) and it
// still earns its place without one: apportioning 301 over 2:3:5 leaves
// remainders that 300 does not, so a size split that rounded each share instead
// of using largest-remainder is still caught below.
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
check("and the figure is 2 x (301 + 199)", byOrder, 1000);
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
    ["S", 160],
    ["M", 189],
    ["L", 151],
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
  "a size row is exactly that size's column of the matrix (M = 90 + 99)",
  (productionSlices("combination", threeWay) as ProductionSlice[])
    .filter((s) => s.label.endsWith("· M"))
    .reduce((a, s) => a + s.qty, 0),
  189,
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
  afterMoq: 567,
  finalQty: 600,
});
check("an MOQ alone still behaves exactly as it did", lineQuantity([100], 500, null, true), {
  calcQty: 100,
  excessCalcQty: 100,
  afterMoq: 500,
  finalQty: 500,
});
check("neither: the chain is the requirement, untouched", lineQuantity([567], null, null, true), {
  calcQty: 567,
  excessCalcQty: 567,
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
  afterMoq: 567,
  finalQty: 567,
});

// THE ROLLUP SURVIVES THE NEW STEP. Five colour rows of 20 round ONCE, at the
// line — rounding each row to the next 50 would buy 250 for an order needing
// 100, which is the per-row failure `moqRollup` was written against.
check("five colour rows round once, not five times", lineQuantity(fiveRows, null, 50, true), {
  calcQty: 100,
  excessCalcQty: 100,
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
  { calcQty: 1200, excessCalcQty: 1236, afterMoq: 2000, finalQty: 2000 },
);
refute(
  "an MOQ never lifts the CONSUMED figure",
  (lineQuantity([1236], 2000, 500, true, [1200]) as { calcQty: number }).calcQty,
  2000,
);
check(
  "with no wastage the two columns agree, and that is a real answer",
  lineQuantity([1200], null, null, true, [1200]),
  { calcQty: 1200, excessCalcQty: 1200, afterMoq: 1200, finalQty: 1200 },
);
check(
  "a caller that does not ask for the split still gets a usable calcQty",
  (lineQuantity([567], null, 50, true) as { calcQty: number }).calcQty,
  567,
);

console.log(failed === 0 ? "\nAll BOM requirement vectors pass." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
