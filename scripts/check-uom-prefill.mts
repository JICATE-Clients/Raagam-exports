/**
 * Vectors for `uomPatchForMaterial` — what happens to a BOM line's units when
 * its material changes (`lib/orders/material-bom/uom-prefill.ts`).
 *
 * ## WHY THIS FILE EXISTS
 *
 * Three of the rule's branches only fire on an EDIT path: swapping the material
 * on a line that already carries units and a pack. Nobody exercises that by
 * hand, and every failure it guards is silent — the cell still renders, still
 * offers the stale unit, and still saves. "Buttons in KGS" is not an error
 * anywhere on this screen; it is a purchase order that cannot be generated,
 * discovered days later.
 *
 * The pack branch is worse than silent. `resolveLinePack` takes a stored
 * `uom_conversion_id` verbatim, with no `item_id` test, so an unswapped pack
 * multiplies the purchase quantity by the WRONG material's factor — 144 to a
 * gross applied to a thread — with every figure on screen still looking checked.
 *
 * Run: `npm run check:uom-prefill`.
 */
import {
  uomPatchForMaterial,
  type ConversionOwner,
  type UomLine,
} from "../lib/orders/material-bom/uom-prefill.ts";

let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}\n          got  ${a}\n          want ${e}`);
  }
}

/** Asserts a value is NOT something — the wrong answer a plausible
 *  implementation gives. */
function refute(label: string, actual: unknown, notExpected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(notExpected)) {
    failed++;
    console.log(`  FAIL  ${label}\n          must not be ${JSON.stringify(notExpected)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

const BUTTON = "item-button";
const YARN = "item-yarn";
const THREAD = "item-thread";

const PCS = "uom-pcs";
const KGS = "uom-kgs";
const MTR = "uom-mtr";
const CONE = "uom-cone";

/** What each material declares — base, plus its purchase unit when it has an
 *  alternate. This is what the screen passes as `declaredUomIds`. */
const DECLARES: Record<string, string[]> = {
  [BUTTON]: [PCS],
  [YARN]: [KGS],
  [THREAD]: [MTR, CONE], // bought in cones, consumed in metres
};

const CONVERSIONS: ConversionOwner[] = [
  { id: "conv-yarn-bag", item_id: YARN },
  { id: "conv-thread-cone", item_id: THREAD },
];

const line = (l: Partial<UomLine> = {}): UomLine => ({
  purchase_uom_id: null,
  consumption_uom_id: null,
  uom_conversion_id: null,
  ...l,
});

const swap = (l: UomLine, to: string | null) =>
  uomPatchForMaterial(l, to, to ? (DECLARES[to] ?? []) : [], CONVERSIONS);

/**
 * THE LINE AFTER THE SWAP — patch applied.
 *
 * EVERY "must not survive" VECTOR ASKS THIS, NEVER THE PATCH, and the
 * distinction is the whole reason this helper exists. A patch that OMITS a key
 * means "keep what is there", so `swap(...).purchase_uom_id` is `undefined` on
 * exactly the broken implementation the refute is aimed at — the assertion
 * passes, the stale unit survives, and the check reports success. Two vectors
 * here were written that way and both passed against a deliberately disabled
 * drop before this was fixed (2026-08-28).
 */
const after = (l: UomLine, to: string | null): UomLine => ({ ...l, ...swap(l, to) });

console.log("\n§1  A MATERIAL THAT DECLARES ONE UNIT FILLS BOTH CELLS");

check(
  "a blank line takes the single unit in both",
  swap(line(), BUTTON),
  { purchase_uom_id: PCS, consumption_uom_id: PCS },
);
// THE 60-80% RULE, stated as itself: the operator picks the material and
// answers nothing else.
refute(
  "...it does NOT leave the operator to type the same unit twice",
  swap(line(), BUTTON),
  {},
);

console.log("\n§2  A MATERIAL WITH AN ALTERNATE UNIT FILLS NEITHER");

// Bought in CONES, consumed in MTR. Defaulting either would make a procurement
// decision nobody asked for, on the field that decides what gets bought.
check(
  "two declared units means two deliberate answers",
  swap(line(), THREAD),
  {},
);
check(
  "...and picking it after a single-unit material still clears, never defaults",
  swap(line({ purchase_uom_id: PCS, consumption_uom_id: PCS }), THREAD),
  { purchase_uom_id: null, consumption_uom_id: null },
);

console.log("\n§3  A SWAP DROPS WHAT THE NEW MATERIAL CANNOT OFFER");

// THE REPORTED CASE. Yarn (KGS) becomes a button (PCS).
check(
  "yarn to button: KGS goes, PCS arrives, in one pass",
  swap(line({ purchase_uom_id: KGS, consumption_uom_id: KGS }), BUTTON),
  { purchase_uom_id: PCS, consumption_uom_id: PCS },
);
// The drop is what re-arms the fill. Without the drop the cell keeps KGS and
// the fill's "only while blank" guard declines — which is the bug.
refute(
  "...KGS must NOT survive onto a button",
  after(line({ purchase_uom_id: KGS, consumption_uom_id: KGS }), BUTTON)
    .purchase_uom_id,
  KGS,
);
check(
  "one stale cell and one blank one both end up right",
  swap(line({ purchase_uom_id: KGS }), BUTTON),
  { purchase_uom_id: PCS, consumption_uom_id: PCS },
);

console.log("\n§4  A UNIT THE NEW MATERIAL STILL OFFERS IS KEPT");

// Nothing is wiped for its own sake: a swap between two materials that share a
// unit leaves the operator's answer alone.
check(
  "a shared unit survives the swap and nothing is written",
  swap(line({ purchase_uom_id: PCS, consumption_uom_id: PCS }), BUTTON),
  {},
);
// On a two-unit material, a valid held unit stays and the OTHER cell is still
// not defaulted — the two rules do not leak into each other.
check(
  "a valid unit on a two-unit material is kept, and its partner stays blank",
  swap(line({ purchase_uom_id: CONE }), THREAD),
  {},
);

console.log("\n§5  THE PACK GOES WITH THE MATERIAL — the silent one");

check(
  "the old material's pack is dropped",
  swap(
    line({ purchase_uom_id: KGS, consumption_uom_id: KGS, uom_conversion_id: "conv-yarn-bag" }),
    BUTTON,
  ),
  { purchase_uom_id: PCS, consumption_uom_id: PCS, uom_conversion_id: null },
);
// `resolveLinePack` looks a stored conversion up by id and does NOT test
// `item_id`, so a surviving pack multiplies the purchase quantity by another
// material's factor. This is the vector that stands for that.
refute(
  "...a conversion belonging to another material must NOT survive",
  after(line({ uom_conversion_id: "conv-yarn-bag" }), BUTTON).uom_conversion_id,
  "conv-yarn-bag",
);
check(
  "a pack that belongs to the NEW material is kept",
  swap(line({ purchase_uom_id: CONE, uom_conversion_id: "conv-thread-cone" }), THREAD),
  {},
);
// An id naming a row that no longer exists leaves `resolveLinePack` with a null
// pack and the line quietly unpriceable, so it is dropped too.
check(
  "a conversion id that resolves to nothing is dropped",
  swap(line({ purchase_uom_id: CONE, uom_conversion_id: "conv-deleted" }), THREAD),
  { uom_conversion_id: null },
);

console.log("\n§6  CLEARING THE MATERIAL CLEARS NOTHING");

// The picker's ✕ is one mis-click from wiping three cells. With no material
// chosen nothing is invalid, so nothing is touched.
check(
  "clearing writes no patch at all",
  swap(
    line({ purchase_uom_id: KGS, consumption_uom_id: KGS, uom_conversion_id: "conv-yarn-bag" }),
    null,
  ),
  {},
);
refute(
  "...it does NOT wipe the units",
  after(line({ purchase_uom_id: KGS }), null).purchase_uom_id,
  null,
);

console.log("\n§7  A MATERIAL THAT DECLARES NOTHING");

// A master row with no base unit: there is nothing to offer and nothing to
// default to. The stale unit still goes — it is not this material's.
check(
  "no declared units drops the stale one and fills nothing",
  uomPatchForMaterial(line({ purchase_uom_id: KGS }), "item-unknown", [], CONVERSIONS),
  { purchase_uom_id: null },
);

console.log(
  failed === 0
    ? "\nOK — every uom-prefill vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
