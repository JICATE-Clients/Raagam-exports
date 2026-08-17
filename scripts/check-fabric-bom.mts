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
    sizeName: (id) => SIZE_NAMES[id] ?? id,
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
check(
  "wastage above 100 refuses",
  refusalOf(fabricRequirementFor(line({ wastage_pct: 120 }), slice)),
  "Wastage must be between 0 and 100",
);
check(
  "a negative wastage refuses",
  refusalOf(fabricRequirementFor(line({ wastage_pct: -1 }), slice)),
  "Wastage must be between 0 and 100",
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
// 8. The order's Excess % is inside the target, and is applied ONCE
// ---------------------------------------------------------------------------

const withExcess = order({ excessPct: 10, approvals: [approval(600, "WHITE")], combos: [combo("WHITE")] });

check("10% excess on 600 pieces is planned as 660", total("colour", WHITE, line(), withExcess), 165);
refute(
  "…not as 600, which would be reading the order qty raw",
  total("colour", WHITE, line(), withExcess),
  150,
);
// Excess buffers the PIECES and wastage buffers the FABRIC. Both apply, neither
// twice: 660 x 0.25 x 1.10.
check(
  "excess and wastage compose without compounding either",
  total("colour", WHITE, line({ wastage_pct: 10 }), withExcess),
  181.5,
);

console.log(failed === 0 ? "\nOK — every fabric requirement vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
