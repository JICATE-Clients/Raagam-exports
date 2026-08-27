/**
 * Vectors for `lib/orders/amendments/pack-composition.ts` — the retail SET pack
 * explosion (0467).
 *
 *   npm run check:pack
 *
 * ## WHY THIS ONE NEEDS VECTORS
 *
 * Because the number it produces is `po_qty`, and `po_qty` is what every
 * downstream engine multiplies. `targetsOf` in the Material BOM engine folds an
 * approval row through an exhaustive three-branch switch with NO multiplier;
 * so does `fullTarget`, `totalProductionQty` and `bom-ceiling.ts`. If this
 * module is wrong by the set size, every trim and every kilo of cloth is wrong
 * by the set size — and each individual figure still looks plausible on its own
 * screen. That is the failure mode nobody reports.
 *
 * The client's own worked example is pinned below verbatim: 1,000 packs x 3
 * pieces = 3,000 garments.
 *
 * Runs under `tsx` for `check-bom-requirement.mts`'s reason: the module is
 * imported through a relative path here, but the runner is kept uniform with
 * its siblings so a future `@/lib/...` import does not silently fail to resolve.
 */
import {
  piecesPerPack,
  derivedPoQty,
  packRowStarted,
  packMemberKey,
  type PackComponentRow,
} from "../lib/orders/amendments/pack-composition.ts";

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

/** Asserts a value is NOT something — the wrong answer a plausible
 *  implementation gives. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

let seq = 0;
const member = (over: Partial<PackComponentRow> = {}): PackComponentRow => ({
  key: `k${++seq}`,
  coordinate_id: "TOP",
  combo: "",
  qty_per_pack: "1",
  ...over,
});

// ---------------------------------------------------------------------------
// 1. The pyjama set — the ordinary case
// ---------------------------------------------------------------------------

const pyjama = [
  member({ coordinate_id: "TOP", qty_per_pack: "1" }),
  member({ coordinate_id: "BOTTOM", qty_per_pack: "1" }),
];

check("a Top + a Bottom is 2 pieces per pack", piecesPerPack(pyjama), 2);
check("1,000 pyjama sets is 2,000 garments", derivedPoQty(pyjama, "1000"), 2000);

// ---------------------------------------------------------------------------
// 2. THE CLIENT'S OWN WORKED EXAMPLE, verbatim (2026-08-25)
//
//    "1,000 Packs x 3 Pieces/Pack = 3,000 individual garments"
//
// Entered the way the client describes it: a 3-pack of bodysuits is ONE
// coordinate three times over in three different colours.
// ---------------------------------------------------------------------------

const threePack = [
  member({ coordinate_id: "BODYSUIT", combo: "NAVY", qty_per_pack: "1" }),
  member({ coordinate_id: "BODYSUIT", combo: "WHITE", qty_per_pack: "1" }),
  member({ coordinate_id: "BODYSUIT", combo: "GREY", qty_per_pack: "1" }),
];

check("a 3-pack is 3 pieces per pack", piecesPerPack(threePack), 3);
check("1,000 x 3 = 3,000 (the client's figure)", derivedPoQty(threePack, "1000"), 3000);

/**
 * THE SAME PACK ENTERED THE OTHER WAY MUST AGREE.
 *
 * An operator may type one row of three rather than three rows of one where the
 * colours do not matter. Both are the same physical pack, so both must explode
 * to the same figure — if they did not, the piece count would depend on data
 * entry style, which is the kind of divergence nobody thinks to look for.
 */
const threeInOneRow = [member({ coordinate_id: "BODYSUIT", qty_per_pack: "3" })];
check("3 in one row is the same pack", piecesPerPack(threeInOneRow), 3);
check("...and the same piece count", derivedPoQty(threeInOneRow, "1000"), 3000);

// ---------------------------------------------------------------------------
// 3. THE WRONG ANSWERS A PLAUSIBLE IMPLEMENTATION GIVES
//
// These are the whole point of the suite. Each is a real mistake that
// type-checks, runs, and produces a number the screen renders without complaint.
// ---------------------------------------------------------------------------

refute(
  "packs are MULTIPLIED by the set size, not returned raw",
  derivedPoQty(threePack, "1000"),
  1000,
);
refute(
  "...and not ADDED to it",
  derivedPoQty(threePack, "1000"),
  1003,
);
refute(
  "...and the row COUNT is not the multiplier when quantities differ",
  // 2 rows, 5 pieces. Counting rows gives 2,000; summing quantities gives 5,000.
  derivedPoQty(
    [
      member({ coordinate_id: "TOP", qty_per_pack: "2" }),
      member({ coordinate_id: "BOTTOM", qty_per_pack: "3" }),
    ],
    "1000",
  ),
  2000,
);
check(
  "...it is the SUM of the quantities",
  derivedPoQty(
    [
      member({ coordinate_id: "TOP", qty_per_pack: "2" }),
      member({ coordinate_id: "BOTTOM", qty_per_pack: "3" }),
    ],
    "1000",
  ),
  5000,
);

// ---------------------------------------------------------------------------
// 4. NULL IS AN ANSWER. 0 IS NOT.
//
// A zero in the PO Qty box reads as an order for nothing, which is a claim.
// "Not answered" is not a claim, and the two must never be the same value.
// ---------------------------------------------------------------------------

check("an empty composition cannot be exploded", derivedPoQty([], "1000"), null);
refute("...and does NOT read as zero pieces", derivedPoQty([], "1000"), 0);

check("no pack count cannot be exploded", derivedPoQty(pyjama, ""), null);
refute("...and does NOT read as zero pieces", derivedPoQty(pyjama, ""), 0);

check("zero packs is still not an explosion", derivedPoQty(pyjama, "0"), null);
check("a composition of blank quantities is not an explosion", derivedPoQty(
  [member({ qty_per_pack: "" }), member({ coordinate_id: "BOTTOM", qty_per_pack: "" })],
  "1000",
), null);

/**
 * A STARTED ROW WITH A BLANK QUANTITY MUST UNDER-READ, NOT OVER-READ.
 *
 * Half-filled, the pack is smaller than it will be. Under-reading keeps
 * `derivedPoQty` honest and lets the screen's `packProblems` complain; treating
 * a blank as 1 would let an unfinished pack explode into a confident — and
 * wrong — piece count.
 */
check(
  "a member with no quantity contributes nothing yet",
  piecesPerPack([member({ qty_per_pack: "1" }), member({ coordinate_id: "BOTTOM", qty_per_pack: "" })]),
  1,
);

// ---------------------------------------------------------------------------
// 5. What counts as STARTED
// ---------------------------------------------------------------------------

check(
  "naming a garment starts the row",
  packRowStarted(member({ coordinate_id: "TOP" })),
  true,
);
check(
  "a quantity alone does not — it is a number attached to nothing",
  packRowStarted(member({ coordinate_id: null, qty_per_pack: "3" })),
  false,
);
check(
  "nor does a colour alone",
  packRowStarted(member({ coordinate_id: null, combo: "NAVY", qty_per_pack: "" })),
  false,
);

// ---------------------------------------------------------------------------
// 6. What counts as a DUPLICATE — the axis the client's example turns on
//
// If this key dropped `combo`, the 3-pack above would be refused as three
// copies of one member and would explode to 1,000 pieces instead of 3,000.
// ---------------------------------------------------------------------------

check(
  "the same garment in a DIFFERENT colour is a different member",
  packMemberKey(member({ coordinate_id: "BODYSUIT", combo: "NAVY" })) ===
    packMemberKey(member({ coordinate_id: "BODYSUIT", combo: "WHITE" })),
  false,
);
check(
  "the same garment in the SAME colour is the same member",
  packMemberKey(member({ coordinate_id: "BODYSUIT", combo: "NAVY" })) ===
    packMemberKey(member({ coordinate_id: "BODYSUIT", combo: "NAVY" })),
  true,
);
/**
 * CASE-INSENSITIVE, because `combo` is capitalised by the Zod transform on the
 * way to the database but is typed in whatever case the operator used. A
 * duplicate the form admits is one the database rejects with a `23505` the
 * screen has no way to explain.
 */
check(
  "colour is compared case-insensitively, as the database stores it",
  packMemberKey(member({ coordinate_id: "BODYSUIT", combo: "navy" })) ===
    packMemberKey(member({ coordinate_id: "BODYSUIT", combo: "NAVY" })),
  true,
);
check(
  "...and whitespace does not make a second member",
  packMemberKey(member({ coordinate_id: "BODYSUIT", combo: " NAVY " })) ===
    packMemberKey(member({ coordinate_id: "BODYSUIT", combo: "NAVY" })),
  true,
);

// ---------------------------------------------------------------------------

if (failed > 0) {
  console.error(`\n${failed} vector(s) failed`);
  process.exit(1);
}
console.log("\nall pack-composition vectors pass");
