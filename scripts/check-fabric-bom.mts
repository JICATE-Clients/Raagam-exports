/**
 * Vectors for `lib/orders/fabric-bom/requirement.ts` — how much finished fabric
 * a garment order needs.
 *
 * THIS MODULE'S OUTPUT IS SPENT, and on the largest line in the order. Fabric is
 * the dominant cost of a knitted garment, so a 5% error here outweighs every trim
 * on the Material BOM put together. `check-bom-requirement.mts` makes the general
 * argument for vectoring this engine at all; what follows is what is DIFFERENT
 * about fabric, because re-testing the shared production-target machinery here
 * would be a second suite drifting from the first.
 *
 * ## THE ONE THAT MATTERS: `colour_size` IS NOT THE MATERIAL ENGINE'S `size`
 *
 * Both words mean "split by size". They produce different row sets on purpose —
 * the material engine COLLAPSES the colour axis (a Medium label is a Medium label
 * whatever the shirt), and a dyed fabric cannot be collapsed that way. Two
 * plausible implementations therefore disagree by a factor of the colour count,
 * and the totals still tie out, so a suite that only asserted sums would pass
 * over it. Section 3 is built to make them disagree and to say which answer is
 * forbidden.
 *
 * ## THE SECOND ONE: THE ORDER IS VALIDATED BEFORE THE LINE IS FILTERED
 *
 * A line scoped to WHITE must refuse when NAVY is the colour carrying a
 * Combos/Approval-Qty disagreement. The obvious implementation — filter, then
 * validate what is left — passes every arithmetic vector and ships a BOM short by
 * a colourway. Section 5 is the only thing standing between the two.
 *
 * Runs under `tsx` for `check-bom-requirement.mts`'s reason: the engine imports
 * `@/lib/...` aliases at runtime and Node's ESM resolver reads neither the alias
 * nor the missing extension.
 */
import {
  FABRIC_BASES,
  fabricBasisOf,
  fabricLineTotal,
  fabricRequirementFor,
  fabricRequirementRows,
  fabricSlices,
  isRefusal,
  type FabricBasis,
  type FabricLineInput,
  type FabricLineScope,
} from "../lib/orders/fabric-bom/requirement.ts";
import {
  productionSlices,
  type ApprovalRow,
  type ComboRow,
  type AssortSizeRow,
  type OrderProductionInput,
} from "../lib/orders/material-bom/requirement.ts";
import {
  GRAMS_CONVERSION,
  calcModeOf,
  calculatedGrams,
  consumptionMap,
  effectiveLength,
  gramsFor,
  requiredKg,
  manualProblem,
  netKg,
  takenComponentIds,
  type ManualSizeInput,
} from "../lib/orders/fabric-bom/manual.ts";
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
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
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
const SZ_S = "11111111-1111-1111-1111-111111111111";
const SZ_M = "22222222-2222-2222-2222-222222222222";
const SIZE_NAMES: Record<string, string> = { [SZ_S]: "S", [SZ_M]: "M" };

const approval = (qty: number, combo = "WHITE", ref = S1): ApprovalRow => ({
  style_ref_no: ref,
  combo,
  qty,
  approval_qty: 0,
});
const combo = (name = "WHITE", ref = S1): ComboRow => ({ style_ref_no: ref, combo: name });
const assort = (size: string, qty: number, comboName = "WHITE", ref = S1): AssortSizeRow => ({
  style_ref_no: ref,
  combo: comboName,
  size_id: size,
  qty,
});

/** One style, two colourways of 600 and 400, an even S/M split on each. */
function order(over: Partial<OrderProductionInput> = {}): OrderProductionInput {
  return {
    excessPct: 0,
    rejectionPct: 0,
    rejectionRuleChosen: false,
    tiers: null,
    approvals: [approval(600, "WHITE"), approval(400, "NAVY")],
    combos: [combo("WHITE"), combo("NAVY")],
    assortSizes: [
      assort(SZ_S, 1, "WHITE"),
      assort(SZ_M, 1, "WHITE"),
      assort(SZ_S, 1, "NAVY"),
      assort(SZ_M, 1, "NAVY"),
    ],
    sizeNames: SIZE_NAMES,
    ...over,
  };
}

/** 0.25 kg per garment, no wastage, 2 decimal places. */
const line = (over: Partial<FabricLineInput> = {}): FabricLineInput => ({
  consumption: 0.25,
  wastage_pct: 0,
  decimals: 2,
  ...over,
});

/** One Manual-tab size row (0494), in DIRECT mode — a size and its typed gram
 *  weight. The measurement cells are the CALCULATED mode's inputs and are left
 *  null here, so a vector using this fixture cannot accidentally be answered by
 *  the formula instead of by the figure. */
const sizeRow = (size_id: string, grams: number | null): ManualSizeInput => ({
  size_id,
  dia: null,
  purchase_width: null,
  grams,
  table_width: null,
  length: null,
  length_tolerance: null,
  cons_qty: null,
});

/** One entry, as `manualProblem` wants it. */
const entry = (over: Partial<Parameters<typeof manualProblem>[0]> = {}) => ({
  style_ref_no: S1,
  /* THE CLOTH, which is what an entry names since 0522 — legacy's Manual row has
     a Fabric column and no Structure column. `structure_id` rides along because
     the GSM lookup keys by it, and the server re-derives it from this cloth. */
  item_id: "i-1",
  structure_id: "s-1",
  calc_mode: "direct",
  component_ids: ["c-front"],
  sizes: [sizeRow(SZ_S, 200), sizeRow(SZ_M, 220)],
  ...over,
});

const ALL: FabricLineScope = { style_ref_no: null, combo: null };
const WHITE: FabricLineScope = { style_ref_no: S1, combo: "WHITE" };
const NAVY: FabricLineScope = { style_ref_no: S1, combo: "NAVY" };

/** The whole pipeline, as the screen and the server both run it. */
function rows(basis: FabricBasis, scope: FabricLineScope, l = line(), o = order()) {
  const r = fabricRequirementRows(basis, scope, l, o);
  if (isRefusal(r)) return r;
  return r.map((x) => ({ label: x.label, value: x.required }));
}
function total(basis: FabricBasis, scope: FabricLineScope, l = line(), o = order()): number | null {
  const r = fabricRequirementRows(basis, scope, l, o);
  return isRefusal(r) ? null : fabricLineTotal(r);
}
/** How many rows an explosion produced. A refusal counts as `null`, never as 0 —
 *  "refused" and "no rows" are the two answers this suite is here to keep apart. */
function rowCount(basis: FabricBasis, scope: FabricLineScope): number | null {
  const r = fabricRequirementRows(basis, scope, line(), order());
  return isRefusal(r) ? null : r.length;
}

// ---------------------------------------------------------------------------
// 1. The arithmetic
// ---------------------------------------------------------------------------

check("0.25 kg on 600 WHITE pieces = 150", total("colour", WHITE), 150);
check("0.25 kg across both colourways = 250", total("colour", ALL), 250);

check(
  "the whole order splits into one row per colourway",
  rows("colour", ALL),
  [
    { label: "WHITE", value: 150 },
    { label: "NAVY", value: 100 },
  ],
);

// Wastage multiplies the FABRIC, never the pieces. 600 x 0.25 x 1.05.
check("5% wastage on 150 kg = 157.5", total("colour", WHITE, line({ wastage_pct: 5 })), 157.5);

// ---------------------------------------------------------------------------
// 2. Rounding is UP, at the consumption UOM's own precision
//
// The client's own figures divide evenly, so every rounding bug is invisible on
// them. 0.23212 x 600 = 139.272 is chosen because ceil, round-to-nearest and
// truncate all give DIFFERENT answers at two places — and a shortfall is a
// shortfall on the cutting table.
// ---------------------------------------------------------------------------

const oddLine = line({ consumption: 0.23212 });

check("139.272 kg rounds UP to 139.28", total("colour", WHITE, oddLine), 139.28);
refute("…and never to the nearest, 139.27", total("colour", WHITE, oddLine), 139.27);

// A clean figure must NOT gain a hundredth. `ceilToPrecision`'s toFixed(6) is
// what absorbs `150.0000000000001`, and without it every tidy example drifts.
check("a figure that is already exact stays exact", total("colour", WHITE), 150);

// THE PRECISION FLOOR IS 2, EVEN WHEN THE UOM SAYS 0 — and this vector is here
// because it caught a wrong expectation in this very file. `uomPrecision` clamps
// to [2, 6] deliberately: every UOM in the live DB stores 0 in the OTHER
// precision column (`decimal_places`, 0224), and honouring it would render
// 16.67 Gross as "17", reinstating the round-up the client rejected. So
// `decimals: 0` does not mean whole kilos here, and a caller that genuinely
// wants whole units must round at the call site where it is visible.
check(
  "a UOM claiming 0 decimals still gets 2 — the clamp, not whole units",
  total("colour", WHITE, line({ consumption: 0.23212, decimals: 0 })),
  139.28,
);
refute(
  "…so it is not silently rounded to a whole kilo",
  total("colour", WHITE, line({ consumption: 0.23212, decimals: 0 })),
  140,
);

// ---------------------------------------------------------------------------
// 3. `colour_size` KEEPS THE COLOUR AXIS — the vector this file exists for
//
// The material engine's `size` basis collapses it deliberately. If fabric ever
// explodes through that basis instead of `combination`, the totals STILL TIE OUT
// and only the row set changes, so nothing but an explicit row-count assertion
// catches it.
// ---------------------------------------------------------------------------

check("two colourways x two sizes = four rows", rowCount("colour_size", ALL), 4);
refute(
  "…never two, which is the material engine's size basis collapsing colour",
  rowCount("colour_size", ALL),
  2,
);
check(
  "and every row names its colour AND its size",
  rows("colour_size", ALL),
  [
    { label: "WHITE · S", value: 75 },
    { label: "WHITE · M", value: 75 },
    { label: "NAVY · S", value: 50 },
    { label: "NAVY · M", value: 50 },
  ],
);

// The proof that this is a real distinction and not a naming preference: the
// material engine, asked for `size` on the SAME order, gives two rows.
check(
  "the material engine's own `size` basis really does give two",
  (() => {
    const s = productionSlices("size", order());
    return isRefusal(s) ? null : s.length;
  })(),
  2,
);

// Cross-basis invariant. Splitting finer must not change the total — that is
// what says the apportionment is a split and not a re-derivation.
check("colour and colour_size agree on the total", total("colour_size", ALL), total("colour", ALL));

// ---------------------------------------------------------------------------
// 4. Scope — a line is for one colourway, or for all of them
// ---------------------------------------------------------------------------

check("a NAVY line takes only NAVY", rows("colour", NAVY), [{ label: "NAVY", value: 100 }]);

check(
  "per-colourway lines sum to the un-scoped line",
  (total("colour", WHITE) ?? 0) + (total("colour", NAVY) ?? 0),
  total("colour", ALL),
);

// A SCOPE THAT MATCHES NOTHING REFUSES. An empty list would multiply out to no
// requirement rows, which renders as a line needing no fabric at all.
check(
  "a colourway the order does not have is named, not silently empty",
  refusalOf(fabricSlices("colour", { style_ref_no: S1, combo: "OLIVE" }, order())),
  "TSH-001 · OLIVE is not a colourway on this order",
);
refute(
  "…and is not an empty slice list",
  (() => {
    const s = fabricSlices("colour", { style_ref_no: S1, combo: "OLIVE" }, order());
    return isRefusal(s) ? "refused" : s.length;
  })(),
  0,
);

// ---------------------------------------------------------------------------
// 5. THE ORDER IS VALIDATED BEFORE THE LINE IS FILTERED
//
// NAVY is declared on the Combos tab and carries no Approval Qty. A WHITE line
// must still refuse: filter-then-validate computes WHITE happily and the BOM
// ships short by a colourway, with every arithmetic vector above still green.
// ---------------------------------------------------------------------------

const navyUnquantified = order({ approvals: [approval(600, "WHITE")] });

check(
  "a WHITE line refuses while NAVY has no quantity",
  refusalOf(fabricRequirementRows("colour", WHITE, line(), navyUnquantified)),
  "Combo NAVY has no quantity on Approval Qty",
);
refute(
  "…rather than quietly answering for WHITE alone",
  (() => {
    const r = fabricRequirementRows("colour", WHITE, line(), navyUnquantified);
    return isRefusal(r) ? "refused" : fabricLineTotal(r);
  })(),
  150,
);

// ---------------------------------------------------------------------------
// 6. Refusals on the line itself — NULL IS AN ANSWER, 0 IS NOT
// ---------------------------------------------------------------------------

const slice = (() => {
  const s = fabricSlices("colour", WHITE, order());
  if (isRefusal(s)) throw new Error("fixture broke");
  return s[0];
})();

check(
  "a blank consumption refuses",
  refusalOf(fabricRequirementFor(line({ consumption: null }), slice)),
  "Enter the fabric consumption per garment",
);
check(
  "a consumption of 0 refuses too — every grid opens on a blank row",
  refusalOf(fabricRequirementFor(line({ consumption: 0 }), slice)),
  "Enter the fabric consumption per garment",
);
refute(
  "…and never answers 0, which reads as 'no fabric needed'",
  fabricRequirementFor(line({ consumption: 0 }), slice),
  0,
);
/* THE SENTENCE NAMES "each loss" SINCE 0523, because the row carries two of
   them — "EndBit Loss %" and "Component Proc. Loss %" — and "wastage" alone
   would send the planner to the wrong cell. */
check(
  "a loss above 100 refuses",
  refusalOf(fabricRequirementFor(line({ wastage_pct: 120 }), slice)),
  "Each loss % must be between 0 and 100",
);
check(
  "a negative loss refuses",
  refusalOf(fabricRequirementFor(line({ wastage_pct: -1 }), slice)),
  "Each loss % must be between 0 and 100",
);
/* AND THE SECOND ONE IS CHECKED TOO, which the pair above cannot prove: a
   reader that validated only `wastage_pct` would let a 150% endbit through and
   silently treble a purchase. */
check(
  "the endbit loss is range-checked as well",
  refusalOf(fabricRequirementFor(line({ endbit_loss_pct: 150 }), slice)),
  "Each loss % must be between 0 and 100",
);

// ---------------------------------------------------------------------------
// 7. The vocabulary
// ---------------------------------------------------------------------------

check("the two bases, and only those two", [...FABRIC_BASES], ["colour", "colour_size"]);
check("case is not the operator's problem", fabricBasisOf("COLOUR"), "colour");
check(
  "an unset basis refuses rather than defaulting",
  refusalOf(fabricBasisOf(null)),
  "Choose how this fabric splits",
);
// THERE IS NO `order` BASIS. Fabric is dyed per colourway, so one un-split kilo
// figure names no lot anyone can knit — and the material engine HAS that basis,
// so borrowing its vocabulary wholesale is the live mistake.
check(
  "the material engine's `order` basis is refused here",
  refusalOf(fabricBasisOf("order")),
  "Choose how this fabric splits",
);
check(
  "and so is its `size`, which means the opposite of ours",
  refusalOf(fabricBasisOf("size")),
  "Choose how this fabric splits",
);

// ---------------------------------------------------------------------------
// 8. Fabric plans the FULL target - excess, approval and rejection
//
// THIS SECTION ASSERTED THE OPPOSITE, and the reversal is why it is inverted
// rather than deleted. It read "the order's Excess % is inside the target, and
// is applied ONCE", and carried a refutation — "not as 600, which would be
// reading the order qty raw" — written to catch an engine doing what this one
// now does deliberately.
//
// Fabric BOM shares `productionSlices` with the material engine ON PURPOSE, so
// that the two can never report different quantities for one order (see this
// file's header). When the client moved the Material BOM onto the ENTERED order
// quantity, that sharing carried fabric with it — and keeping fabric on the old
// target would have meant splitting the one function built to stop them
// disagreeing. A BOM is a BOM: both now plan the quantity entered.
//
// WHAT IT COSTS IS THE SAME ON BOTH SIDES. An order that cuts 5,552 to ship
// 5,000 is short of cloth for 552 garments exactly as it is short of their
// buttons. The line's own Wastage % is the only buffer left, and it is per line
// and typed by hand. `targetsOf` in ../lib/orders/material-bom/requirement.ts
// records how to put the target back; doing so restores this section too.
// ---------------------------------------------------------------------------

const withExcess = order({ excessPct: 10, approvals: [approval(600, "WHITE")], combos: [combo("WHITE")] });

/* 600 + 10% = 660, x 0.25 = 165. THE PREVIOUS EXPECTED VALUE HERE WAS 150 and
   the label read "600 entered is planned as 600, not 660" - the assertion that
   fabric ignored the buyer's excess. It is inverted rather than deleted so the
   reversal stays legible: the refutation that sat below it forbade exactly the
   number now required, which is what a moved rule looks like in a suite that
   states its wrong answers. */
check("600 + 10% excess is planned as 660", total("colour", WHITE, line(), withExcess), 165);
refute(
  "…not 150, which was reading the order qty raw",
  total("colour", WHITE, line(), withExcess),
  150,
);
/* Wastage buffers the FABRIC and stacks ON TOP of the target: 660 x 0.25 x 1.10.
   IT IS NO LONGER "the only buffer" - that phrasing belonged to the entered-only
   rule, where the line's own Wastage % was all that stood between the plan and a
   short delivery. There are three buffers again (excess, rejection, wastage) and
   this vector's job is now to prove they COMPOUND rather than replace each
   other: 181.5, not 165 (wastage alone) and not 150 (neither). */
check(
  "the line's own Wastage % stacks on top of the target",
  total("colour", WHITE, line({ wastage_pct: 10 }), withExcess),
  181.5,
);
refute(
  "…not 165, which would be wastage applied to the raw order qty",
  total("colour", WHITE, line({ wastage_pct: 10 }), withExcess),
  165,
);

/*
 * THE REJECTION ALLOWANCE, which is the whole reason fabric has a rule of its
 * own. A 5% tier over 600 pieces is 30 more garments to cut, so the target is
 * 600 + 60 excess + 30 rejection = 690, and the cloth is 690 x 0.25 = 172.5.
 *
 * The accessory side must NOT move by any of this - asserted below, because the
 * two rules share one function and the shared function is exactly how fabric
 * ended up on a rule nobody chose for it.
 */
const TIERS: RejectionTier[] = [
  { from_value: 1, to_value: null, rejection_allowance: 5, allowance_type: "percent" },
];
const withRejection = order({
  excessPct: 10,
  approvals: [approval(600, "WHITE")],
  combos: [combo("WHITE")],
  tiers: TIERS,
  rejectionRuleChosen: true,
});

check(
  "a named rejection rule adds its tier: 600 + 60 + 30 = 690",
  total("colour", WHITE, line(), withRejection),
  172.5,
);
refute(
  "...not 165, which is the target with the rejection buffer dropped",
  total("colour", WHITE, line(), withRejection),
  165,
);

/*
 * THE FLAT `rejectionPct` (0531, backend calc spec Formula 5) NEVER REACHES
 * FABRIC — it is Material BOM's own companion term, added specifically
 * because Material BOM had no rejection concept at all before it existed.
 * `fullTarget`/`productionTarget` read only the tiered rule above; setting
 * BOTH on one order must produce the identical 690/172.5 this section already
 * proved, not 690 plus a second helping.
 */
const withRejectionAndFlat = order({ ...withRejection, rejectionPct: 8 });
check(
  "a flat rejection_pct alongside the tiered rule changes nothing here",
  total("colour", WHITE, line(), withRejectionAndFlat),
  172.5,
);
refute(
  "...it is not folded into the fabric target a second time",
  total("colour", WHITE, line(), withRejectionAndFlat),
  172.5 * 1.08,
);

/*
 * A RULE NAMED BUT NOT MATCHED REFUSES, and names the colourway.
 *
 * `productionTarget` answers a projection-gap when a rule was chosen and the
 * ladder has no tier covering the quantity. On the Approval Qty tab a dash in
 * the column beside it says so; nothing sits beside THIS number, which becomes
 * the cloth on a purchase order. So it must refuse rather than quietly plan the
 * order without the buffer the operator configured.
 */
const gapped = order({
  excessPct: 10,
  approvals: [approval(600, "WHITE")],
  combos: [combo("WHITE")],
  tiers: [{ from_value: 1, to_value: 100, rejection_allowance: 5, allowance_type: "percent" }],
  rejectionRuleChosen: true,
});
check(
  "a tier gap refuses and names the colourway",
  refusalOf(fabricSlices("colour", WHITE, gapped))?.startsWith("WHITE: the Garment Rejection Rule"),
  true,
);
refute(
  "...it does not silently plan without the buffer",
  total("colour", WHITE, line(), gapped),
  165,
);

/*
 * A BLANK APPROVAL ROW DOES NOT REFUSE. A freshly seeded grid is full of zero
 * rows and `rejectionFor(0, tiers)` matches no tier, so without the `qty <= 0`
 * short-circuit in `fullTarget` an order with a rejection rule and one empty row
 * would refuse the whole explosion and name a colourway nobody has typed into.
 */
const blankRow = order({
  excessPct: 10,
  approvals: [approval(600, "WHITE"), approval(0, "NAVY")],
  combos: [combo("WHITE"), combo("NAVY")],
  tiers: TIERS,
  rejectionRuleChosen: true,
});
check(
  "a zero row contributes nothing and refuses nothing",
  total("colour", WHITE, line(), blankRow),
  172.5,
);

/*
 * THE ACCESSORY SIDE IS UNMOVED. This is the guard, not a courtesy: the two
 * engines share `productionSlices`, and fabric arrived on the entered quantity
 * in the first place by being dragged along behind a change made for material.
 * If this vector ever moves, the sharing has leaked again - in the other
 * direction this time.
 */
const materialRows = productionSlices("colour", withRejection);
check(
  "material still plans 600 + 60 + 0 = 660, with no rejection",
  isRefusal(materialRows) ? materialRows.refused : materialRows.map((r) => [r.label, r.qty]),
  [["WHITE", 660]],
);
refute(
  "...material does NOT pick up the 690 fabric now plans",
  isRefusal(materialRows) ? materialRows.refused : materialRows.map((r) => r.qty),
  [690],
);

// ---------------------------------------------------------------------------
// 7. THE MANUAL TAB — size-wise gram weights (0494)
//
// The client's own framing: fabric and yarn are 70-80% of an order's value, so
// "any minor error in this screen will collapse the downstream purchasing,
// knitting, dyeing, and budgeting calculations". Four things can go wrong and
// only one of them is arithmetic:
//
//   · the per-size map is IGNORED and something else answers — plausible,
//     silent, and it produces a well-formed BOM off a figure nobody typed;
//   · an EMPTY map falls back rather than refusing — the same failure arriving
//     through a `length > 0` test instead of through the code;
//   · grams and kilograms are confused by a factor of 1000, which is the single
//     easiest mistake to make in this module and the most expensive;
//   · a component is counted in two entries, which double-buys its cloth.
//
// Every vector below is built so the wrong answer is a NUMBER rather than a
// crash, because that is the only kind this suite can catch.
// ---------------------------------------------------------------------------

/* 0.20 kg on S and 0.40 kg on M — deliberately NOT averaging to the 0.25 scalar.
   With 300 pieces of each, size-wise gives 60 + 120 = 180 and the scalar gives
   150, so the two cannot be confused. An even split would have made every vector
   in this section pass against an engine that ignored the map entirely. */
const bySizeLine = line({ bySize: { [SZ_S]: 0.2, [SZ_M]: 0.4 } });

check(
  "the size's own consumption is what multiplies, per size",
  rows("colour_size", WHITE, bySizeLine),
  [
    { label: "WHITE · S", value: 60 },
    { label: "WHITE · M", value: 120 },
  ],
);
refute("…and the line's scalar is not what answered", total("colour_size", WHITE, bySizeLine), 150);

/* THE SCALAR IS STILL SET ON THAT LINE (0.25, from `line()`), which is the point
   of this pair: an engine preferring the scalar would look correct on any
   document where nobody had typed one. */
check("a size-wise line ignores its own consumption entirely", total("colour_size", WHITE, bySizeLine), 180);

check(
  "wastage still multiplies on the size-wise route",
  total("colour_size", WHITE, line({ bySize: { [SZ_S]: 0.2, [SZ_M]: 0.4 }, wastage_pct: 5 })),
  189,
);

/* THE CEILING IS THE SHARED ONE. 300 x 0.23212 = 69.636 -> 69.64 on both sizes,
   which is what proves `sizedRequirement` is one function rather than two — a
   second copy would be free to round the size-wise route differently, and the
   difference would only ever show on figures landing on a boundary. */
check(
  "size-wise rounds UP at the same precision as direct",
  rows("colour_size", WHITE, line({ bySize: { [SZ_S]: 0.23212, [SZ_M]: 0.23212 } })),
  [
    { label: "WHITE · S", value: 69.64 },
    { label: "WHITE · M", value: 69.64 },
  ],
);

// -- the refusals -----------------------------------------------------------

check(
  "a size map on the colour basis refuses, naming the split",
  refusalOf(fabricRequirementRows("colour", WHITE, bySizeLine, order())),
  "Size-wise consumption needs the Colour + Size split",
);
refute(
  "…rather than averaging the two figures onto one colourway row",
  total("colour", WHITE, bySizeLine),
  180,
);

/* AN EMPTY MAP IS 'answered by size, nothing filled in' AND MUST NOT FALL BACK.
   This is the presence-vs-length vector: `Object.keys(bySize).length > 0`
   compiles, passes every other vector here, and sends exactly this line back to
   its scalar — 150 kg planned off a number the planner abandoned. An ENTRY has
   no scalar at all, so on the 0494 path the same slip would plan nothing and
   report it as an answer. */
check(
  "an empty size map refuses, naming the first slice",
  refusalOf(fabricRequirementRows("colour_size", WHITE, line({ bySize: {} }), order())),
  "Enter the consumption for WHITE · S",
);
refute("…and never answers 150 from the scalar", total("colour_size", WHITE, line({ bySize: {} })), 150);

/* ONE MISSING SIZE REFUSES THE WHOLE LINE, exactly as one bad slice does on the
   direct route. A partial explosion — S answered, M dropped — yields a SMALLER
   total that looks like a correct answer. */
check(
  "one unanswered size refuses, and names that size",
  refusalOf(fabricRequirementRows("colour_size", WHITE, line({ bySize: { [SZ_S]: 0.2 } }), order())),
  "Enter the consumption for WHITE · M",
);
refute(
  "…rather than shipping the sizes that were answered",
  total("colour_size", WHITE, line({ bySize: { [SZ_S]: 0.2 } })),
  60,
);

check(
  "a size entered as 0 is unanswered, not free",
  refusalOf(
    fabricRequirementRows(
      "colour_size",
      WHITE,
      line({ bySize: consumptionMap("direct", [sizeRow(SZ_S, 200), sizeRow(SZ_M, 0)], null) }),
      order(),
    ),
  ),
  "Enter the consumption for WHITE · M",
);

// -- grams to kilograms, which is where a factor of 1000 hides ---------------

/* THE UNIT BOUNDARY, asserted on its own. The tab works in GRAMS and the engine
   in the line's unit; `consumptionMap` is the single /1000, and every other
   function in the module stays in grams. Getting this wrong is a thousandfold
   error in a purchase weight, and it would still look like a plausible table. */
check(
  "consumptionMap converts grams to kilograms, once",
  consumptionMap("direct", [sizeRow(SZ_S, 200), sizeRow(SZ_M, 220)], null),
  { [SZ_S]: 0.2, [SZ_M]: 0.22 },
);
refute(
  "…and does not hand the engine grams",
  consumptionMap("direct", [sizeRow(SZ_S, 200)], null)[SZ_S],
  200,
);
check("a size with no weight is absent, not zero", consumptionMap("direct", [sizeRow(SZ_S, null)], null), {});
check("a zero weight is absent too", consumptionMap("direct", [sizeRow(SZ_S, 0)], null), {});

// -- THE CLIENT'S OWN WORKED EXAMPLE ----------------------------------------

/* Formula 1, verbatim from the spec: 10,510 pcs x 1 x 50 g Neck (Rib) / 1000 =
   525.5 Kg. It is here because it is the one figure the client stated as an
   ANSWER rather than as a rule, so it is the one this module can be wrong about
   without any reviewer noticing. */
check("10,510 pcs x 50 g = 525.5 kg (the client's Neck/Rib example)", netKg(10510, 1, 50), 525.5);

/* THE SECOND WORKED EXAMPLE, from the 2026-09-03 spec: "Size M Order Qty 500
   Pcs, Manual Cons Qty 1, Manual Cons Wt 120 grams => 500 x 1 x 120g = 60,000g
   (60 kg)". */
check("500 pcs x 1 x 120 g = 60 kg (the client's Size M example)", netKg(500, 1, 120), 60);

/* CONS QTY IS A REAL FACTOR AND NOT DECORATION. It joined the formula on
   2026-09-03; before that the screen had a `Cons Qty` COLUMN that printed
   `netKg`'s own output, so the multiplier had nowhere to be entered. A vector
   that only ever passed 1 could not tell the two apart. */
check("Cons Qty multiplies — 2 panels per garment doubles the net", netKg(500, 2, 120), 120);
check("…and 1.25 metres per t-shirt is 1.25x", netKg(500, 1.25, 120), 75);
check("a blank Cons Qty is ONE, never zero", netKg(500, null, 120), 60);
refute("…and never 0, which would plan the order at no cloth", netKg(500, null, 120), 0);

/* STEP 2 — the allowances COMPOUND. 525.5 x 1.05 = 551.775 with one; with a 1%
   endbit before it, 525.5 x 1.01 x 1.05 = 557.29275. */
check("one loss behaves exactly as the single wastage did", requiredKg(525.5, [5]), 551.775);
/* ROUNDED, AND THE ROUNDING IS THE POINT rather than a convenience.
   `requiredKg` multiplies the FACTORS together first and applies them once
   (1.01 x 1.05 = 1.0605…, then x525.5), where the expression on the right
   applies them one at a time — so the two land on 557.29275 and
   557.2927500000001. Both are the same number; only the float association
   differs, and asserting raw equality across two associations tests the IEEE
   spec rather than this module. Six decimals is far finer than any purchase
   weight and still catches the sum-vs-product error below by a wide margin. */
const p6 = (n: number | null) => (n == null ? null : Math.round(n * 1e6) / 1e6);
check("two losses compound, 1% then 5%", p6(requiredKg(525.5, [1, 5])), p6(525.5 * 1.01 * 1.05));
refute("…and are NOT summed to 6%", p6(requiredKg(525.5, [1, 5])), p6(525.5 * 1.06));
check("order does not matter to the product", requiredKg(525.5, [5, 1]), requiredKg(525.5, [1, 5]));
check("a null loss in the list is 0, not a refusal", requiredKg(525.5, [null, 5]), 551.775);
check("no losses at all leave Net unchanged", requiredKg(525.5, []), 525.5);
check("a null Net is not a zero requirement", requiredKg(null, [5]), null);
refute("…and never 0, which reads as 'no cloth needed'", requiredKg(null, [5]), 0);
check("a loss outside 0-100 refuses rather than scaling", requiredKg(100, [150]), null);
check("…and one bad loss refuses the whole product", requiredKg(100, [5, 150]), null);

/* THE THREE ENTRIES OF THE CLIENT'S OWN SCENARIO B, summed. 180 + 20 + 50 =
   250 g of cloth per garment, and the entries partition the panels so the sum is
   the garment's weight exactly once. This is the vector that would catch a
   grouped entry being multiplied per component. */
check(
  "Scenario B's three entries sum to one garment's 250 g",
  [
    netKg(10510, 1, 180),
    netKg(10510, 1, 20),
    netKg(10510, 1, 50),
  ].reduce((a, b) => a + (b ?? 0), 0),
  netKg(10510, 1, 250),
);

// -- the calculated mode -----------------------------------------------------

/* THE TOLERANCE IS ON THE LENGTH — REVERSED BACK 2026-09-03 (0524), HOURS
   AFTER 0523 MOVED IT TO THE WIDTH ON THE AUTHORITY OF A WRITTEN SPEC
   ("extra safety margin added to the width", "Calculated Width (cm) = Width +
   Tolerance"). 0524 puts it back on the operator's explicit instruction after
   being shown that spec beside a fresh legacy screenshot of the
   `Length | Length Tolerance | Length` band this reverts to. Both readings
   produce a plausible weight, which is why this can flip without either number
   looking wrong on screen — so the vector asserts the LENGTH by name. */
check("effective length adds the tolerance", effectiveLength(70, 2), 72);
check("…and a missing tolerance is 0, not a missing length", effectiveLength(70, null), 70);
check("a tolerance with no length is not a length", effectiveLength(null, 2), null);

/* ADDED, NOT SCALED. Reading the tolerance as a percentage compiles and is wrong
   by a factor of the length: 70 + 2 = 72, where the percentage reading gives
   71.4 — close enough to look right on screen and wrong on every panel. */
refute("…and is not a percentage of the length", effectiveLength(70, 2), 70 * 1.02);

/* 52cm x 72cm x 180 g/m² / 1e4 = 67.392 g. cm² to m², x gsm, and the result is
   GRAMS — the unit the whole tab works in.

   NO x2, AND THIS IS THE VECTOR THAT SAYS SO. The first cut doubled it for
   "front and back panel"; the client's spec states the formula without it. The
   doubling was also wrong on its own terms for a neck rib, which is ONE panel —
   so it is refuted by name here rather than merely absent. */
const measured = { table_width: 52, length: 70, length_tolerance: 2 };
check(
  "the panel weight is width x calc.length x gsm / 1e4, in grams",
  calculatedGrams(measured, 180),
  67.392,
);
refute("…never doubled for a front-and-back that nobody asked for", calculatedGrams(measured, 180), 134.784);
refute("…and not 0.067392, which would be kilograms leaking in", calculatedGrams(measured, 180), 0.067392);

/* THE TOLERANCE REACHES THE WEIGHT, which is the half an `effectiveLength`
   vector alone cannot prove: the formula could still be multiplying the raw
   length. */
refute(
  "the weight uses the CALCULATED length, not the raw one",
  calculatedGrams(measured, 180),
  (52 * 70 * 180) / GRAMS_CONVERSION,
);
refute(
  "…and it is not the 0523 width+tolerance reading either",
  calculatedGrams(measured, 180),
  (54 * 70 * 180) / GRAMS_CONVERSION,
);

/* THE CONSTANT IS NAMED, and the client confirmed 10,000 on 2026-09-03.
   Asserting the formula THROUGH the constant means the day it moves, this vector
   moves with it in one place and every other vector here still pins the shape. */
check(
  "the divisor is GRAMS_CONVERSION, not a literal buried in the expression",
  calculatedGrams(measured, 180),
  (52 * 72 * 180) / GRAMS_CONVERSION,
);

/* IT MULTIPLIES `table_width`, NEVER `dia`. They were one word until 0495 and
   the client separated them: dia is the ROLL's diameter and a constraint,
   table_width is the panel on the cutting table. A reader that grabbed the wrong
   one gets a plausible number — 60 dia against a 52cm panel is only 15% out,
   which is the size of error that survives review. */
check("a dia on the row changes nothing", calculatedGrams({ ...measured, dia: 60 } as never, 180), 67.392);
check("no table width is not a weight", calculatedGrams({ ...measured, table_width: null }, 180), null);
check("no length is not a weight", calculatedGrams({ ...measured, length: null }, 180), null);
check("no GSM is not a weight", calculatedGrams(measured, null), null);
refute("…and an unstated GSM never reads as zero cloth", calculatedGrams(measured, null), 0);

/* THE MODE DECIDES WHICH FIGURE IS REAL, and `gramsFor` is the only place that
   decision is made. The row below carries BOTH a typed 999 and measurements, so
   a reader that consulted the wrong one answers with a number that exists. */
const bothRow: ManualSizeInput = {
  size_id: SZ_S,
  dia: null,
  purchase_width: null,
  grams: 999,
  table_width: 52,
  length: 70,
  length_tolerance: 2,
  cons_qty: null,
};
check("direct mode reads the typed grams", gramsFor("direct", bothRow, 180), 999);
check("calculated mode reads the measurements", gramsFor("calculated", bothRow, 180), 67.392);
check("an unreadable mode falls back to direct, never to a computed figure", gramsFor("nonsense", bothRow, 180), 999);
check("calcModeOf normalises case", calcModeOf("CALCULATED"), "calculated");

/* AND THE MAP FOLLOWS THE MODE. This is the vector that catches a screen
   printing one weight while the server stores another. */
check(
  "consumptionMap is mode-aware",
  consumptionMap("calculated", [bothRow], 180),
  { [SZ_S]: 0.067392 },
);

// -- the "no duplicate component allocation" rule ---------------------------

/* THE RULE THAT MAKES THE ARITHMETIC ADD UP, not a tidiness rule. Entries are
   the counting unit, so the garment's weight is their sum — and that sum is only
   right while the entries partition the panels. */
const S2 = "PLO-002";
const ENTRIES = [
  { key: "e1", style_ref_no: S1, component_ids: ["c-front", "c-back"] },
  { key: "e2", style_ref_no: S1, component_ids: ["c-sleeve"] },
  { key: "e3", style_ref_no: S2, component_ids: ["c-front"] },
  { key: "e4", style_ref_no: null, component_ids: ["c-collar"] },
];

check(
  "a component used by another entry ON THE SAME STYLE is withdrawn",
  [...takenComponentIds(ENTRIES, { key: "e2", style_ref_no: S1 })].sort(),
  ["c-back", "c-collar", "c-front"],
);
/* AN ENTRY'S OWN CHOICES ALWAYS SURVIVE. Without the `except`, opening a saved
   entry would show it as having selected nothing and the first edit would clear
   it — silent data loss dressed up as a filter. */
check(
  "…but never its own",
  [...takenComponentIds(ENTRIES, { key: "e1", style_ref_no: S1 })].sort(),
  ["c-collar", "c-sleeve"],
);

/* THE STYLE SCOPE, WHICH IS THE WHOLE OF 0495's CHANGE HERE. FRONT BODY is used
   by e1 on the tee and by e3 on the polo, and both are legitimate — they are two
   panels wearing one master row. Under 0494's document-wide rule the polo could
   not have named it at all. */
check(
  "a component used on ANOTHER style is not withdrawn",
  [...takenComponentIds(ENTRIES, { key: "e5", style_ref_no: S2 })].sort(),
  ["c-collar", "c-front"],
);
refute(
  "…so the tee's back and sleeve do not block the polo",
  [...takenComponentIds(ENTRIES, { key: "e5", style_ref_no: S2 })].sort(),
  ["c-back", "c-collar", "c-front", "c-sleeve"],
);

/* AN UNSCOPED ENTRY COLLIDES BOTH WAYS, and that is the safe reading rather than
   a gap. `null` means "every style", so e4's collar is used on every style — and
   an unscoped entry in turn sees every style's panels. The alternative lets an
   unscoped entry silently double-count against a scoped one. */
check(
  "an unscoped entry's panels are withdrawn from every style",
  [...takenComponentIds(ENTRIES, { key: "e5", style_ref_no: S2 })].includes("c-collar"),
  true,
);
check(
  "and an unscoped entry sees every style's panels",
  [...takenComponentIds(ENTRIES, { key: "e5", style_ref_no: null })].sort(),
  ["c-back", "c-collar", "c-front", "c-sleeve"],
);

// -- what the Save gate and the Done button both read ------------------------

const NEEDED = [
  { size_id: SZ_S, label: "S" },
  { size_id: SZ_M, label: "M" },
];

check(
  "an entry with no FABRIC is refused first (0522)",
  manualProblem(entry({ item_id: null }), NEEDED, null)?.refused,
  "Choose the fabric this weight is for",
);
/* AND A STRUCTURE ON ITS OWN IS NOT AN ANSWER. Before 0522 this entry passed the
   first gate; the structure is derived now, so a row carrying one and no cloth
   is a row the planner never started. */
check(
  "…and a structure without a fabric does not satisfy it",
  manualProblem(entry({ item_id: null, structure_id: "s-1" }), NEEDED, null)?.refused,
  "Choose the fabric this weight is for",
);
check(
  "…then one with no components",
  manualProblem(entry({ component_ids: [] }), NEEDED, null)?.refused,
  "Choose which components this weight covers",
);
check(
  "an order stating no sizes is its own refusal, not a pass",
  manualProblem(entry(), [], null)?.refused,
  "This order states no sizes for this fabric",
);
check(
  "it names the sizes still blank",
  manualProblem(entry({ sizes: [sizeRow(SZ_S, 200)] }), NEEDED, null)?.refused,
  "Enter the weight for M",
);
check(
  "and stands down once every size is answered",
  manualProblem(entry(), NEEDED, null),
  null,
);

/* THE CALCULATED MODE'S OWN PRECONDITION, named separately because the fix is on
   a DIFFERENT SCREEN. Without it every size reports blank and the planner goes
   looking at the size cells for a fault that is on the order. */
check(
  "calculated mode with no GSM says so, and says where to fix it",
  manualProblem(entry({ calc_mode: "calculated" }), NEEDED, null)?.refused,
  "This fabric's structure states no single GSM on the order, so a weight cannot be calculated — enter it directly, or fix the GSM on the order",
);
refute(
  "…rather than reporting every size as blank",
  manualProblem(entry({ calc_mode: "calculated" }), NEEDED, null)?.refused,
  "Enter the measurements for S, M",
);
check(
  "with a GSM it asks for the measurements, in the calculated mode's words",
  manualProblem(entry({ calc_mode: "calculated" }), NEEDED, 180)?.refused,
  "Enter the measurements for S, M",
);

// -- an entry plans its OWN style, and only that one (0495) ------------------

/* TWO STYLES, ONE ORDER. The fixture order above has one style; this one adds a
   second so the scope has something to exclude. Without the scope an entry for
   the tee would plan the polo's pieces as well — silently, and the total would
   look like a healthy larger number rather than an error. */
const twoStyles = order({
  approvals: [approval(600, "WHITE", S1), approval(400, "WHITE", "PLO-002")],
  combos: [combo("WHITE", S1), combo("WHITE", "PLO-002")],
  assortSizes: [
    assort(SZ_S, 1, "WHITE", S1),
    assort(SZ_M, 1, "WHITE", S1),
    assort(SZ_S, 1, "WHITE", "PLO-002"),
    assort(SZ_M, 1, "WHITE", "PLO-002"),
  ],
});

const scoped: FabricLineScope = { style_ref_no: S1, combo: null };
const unscoped: FabricLineScope = { style_ref_no: null, combo: null };
const perSize = line({ bySize: { [SZ_S]: 0.2, [SZ_M]: 0.2 } });

check(
  "an entry scoped to one style plans only its 600 pieces",
  total("colour_size", scoped, perSize, twoStyles),
  120,
);
refute(
  "…never 200, which is both styles' 1,000 pieces",
  total("colour_size", scoped, perSize, twoStyles),
  200,
);
check(
  "an UNSCOPED entry still plans every style — null means 'every'",
  total("colour_size", unscoped, perSize, twoStyles),
  200,
);
check(
  "and its rows name the style they belong to",
  rows("colour_size", unscoped, perSize, twoStyles).length,
  4,
);

console.log(failed === 0 ? "\nOK — every fabric requirement vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
