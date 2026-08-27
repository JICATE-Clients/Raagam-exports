/**
 * Vectors for `lib/orders/amendments/pack-type-explosion.ts` (0472).
 *
 * The number this module produces is SPENT: it lands in
 * `garment_order_amendment_quantities` as PIECES, the balance rule checks it
 * against PO Qty, and every BOM engine explodes materials from it without a
 * multiplier of its own. A wrong figure here does not surface as an error, it
 * surfaces months later as a factory short of thread.
 *
 * The vectors that earn their place are the ones where two plausible
 * implementations disagree:
 *
 *   - a colourway the pack does NOT hold must be `null`, not 0 — a caller
 *     summing zeros gets a confident answer to a question nobody asked;
 *   - a size with no box count must produce NO CELLS, not zero-valued ones,
 *     because the balance rule reads what is stored back;
 *   - the pack type and the colourway are free text an operator typed, so
 *     matching is case-insensitive — `===` compiles, runs, and explodes
 *     nothing.
 *
 * Run: npx tsx scripts/check-pack-type-explosion.mts
 */

import {
  explodePacks,
  linesOf,
  packContents,
  piecesOfComboPerPack,
  piecesPerPack,
  totalPiecesFromPacks,
  type PackTypeLineLike,
} from "../lib/orders/amendments/pack-type-explosion.ts";

let failed = 0;

function check(what: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`ok    ${what}`);
  } else {
    failed++;
    console.log(`FAIL  ${what}\n        got  ${g}\n        want ${w}`);
  }
}

// ---------------------------------------------------------------------------
// THE CLIENT'S OWN WORKED EXAMPLE (2026-08-27)
//
//   "ABC Pack" = 1 White + 1 Green + 2 Black, four garments in a box.
//   1,000 boxes must become 1,000 White, 1,000 Green and 2,000 Black pieces.
// ---------------------------------------------------------------------------

const ABC = "ABC PACK";
const TEE = "GRILS T SHIRT";
const S = "size-s";
const M = "size-m";

const LINES: PackTypeLineLike[] = [
  { pack_type: ABC, style_ref_no: TEE, combo: "WHITE", qty: 1 },
  { pack_type: ABC, style_ref_no: TEE, combo: "GREEN", qty: 1 },
  { pack_type: ABC, style_ref_no: TEE, combo: "BLACK", qty: 2 },
  // A SECOND METHOD ON THE SAME ORDER, deliberately overlapping in colourway.
  // Every lookup below must ignore it; a filter that forgot the pack type would
  // pass every other vector in this file.
  { pack_type: "GIFT BOX", style_ref_no: TEE, combo: "WHITE", qty: 5 },
];

check("one pack holds four garments", piecesPerPack(LINES, ABC, TEE), 4);
check(
  "the composition is three colourways",
  packContents(LINES, ABC, TEE),
  [
    { combo: "WHITE", qty: 1 },
    { combo: "GREEN", qty: 1 },
    { combo: "BLACK", qty: 2 },
  ],
);
check("the other method is not counted", piecesPerPack(LINES, "GIFT BOX", TEE), 5);
check("and its lines are not borrowed", linesOf(LINES, "GIFT BOX", TEE).length, 1);

check("black is two per pack", piecesOfComboPerPack(LINES, ABC, TEE, "BLACK"), 2);
check("white is one per pack", piecesOfComboPerPack(LINES, ABC, TEE, "WHITE"), 1);

// THE ONE THAT MATTERS: a colourway this method does not pack.
check(
  "a colourway the pack does not hold says NOTHING, not zero",
  piecesOfComboPerPack(LINES, ABC, TEE, "PINK"),
  null,
);

check(
  "1,000 boxes become 1,000 white, 1,000 green and 2,000 black",
  explodePacks(LINES, ABC, TEE, new Map([[S, 1000]])),
  [
    { combo: "WHITE", size_id: S, qty: 1000 },
    { combo: "GREEN", size_id: S, qty: 1000 },
    { combo: "BLACK", size_id: S, qty: 2000 },
  ],
);
check(
  "...and that is 4,000 pieces, not 1,000",
  totalPiecesFromPacks(LINES, ABC, TEE, new Map([[S, 1000]])),
  4000,
);

// ---------------------------------------------------------------------------
// SIZES
// ---------------------------------------------------------------------------

check(
  "two sizes explode independently",
  explodePacks(LINES, ABC, TEE, new Map([[S, 100], [M, 200]])),
  [
    { combo: "WHITE", size_id: S, qty: 100 },
    { combo: "GREEN", size_id: S, qty: 100 },
    { combo: "BLACK", size_id: S, qty: 200 },
    { combo: "WHITE", size_id: M, qty: 200 },
    { combo: "GREEN", size_id: M, qty: 200 },
    { combo: "BLACK", size_id: M, qty: 400 },
  ],
);

// A SIZE NOT ORDERED IS NOT A ROW OF ZEROS. The balance rule reads stored cells
// back, so an explicit 0 is a claim about a size the operator said nothing about.
check(
  "a size with no boxes yields no cells at all",
  explodePacks(LINES, ABC, TEE, new Map([[S, 100], [M, 0]])),
  [
    { combo: "WHITE", size_id: S, qty: 100 },
    { combo: "GREEN", size_id: S, qty: 100 },
    { combo: "BLACK", size_id: S, qty: 200 },
  ],
);
check(
  "a blank box count is not zero boxes either",
  explodePacks(LINES, ABC, TEE, new Map([[S, ""]])),
  [],
);
check(
  "no box counts at all is NOT AN ORDER FOR NONE",
  totalPiecesFromPacks(LINES, ABC, TEE, new Map()),
  null,
);

// ---------------------------------------------------------------------------
// FREE TEXT, TYPED BY AN OPERATOR
//
// `normalizePackTypes` de-duplicates methods case-insensitively and the Zod
// transform stores every value capitalised, so a comparison that respects case
// matches nothing on exactly the documents that already saved correctly.
// ---------------------------------------------------------------------------

check(
  "the pack type matches case-insensitively",
  piecesPerPack(LINES, "abc pack", TEE),
  4,
);
check(
  "...and with stray whitespace",
  piecesPerPack(LINES, "  ABC PACK  ", TEE),
  4,
);
check(
  "the colourway matches case-insensitively",
  piecesOfComboPerPack(LINES, ABC, TEE, "black"),
  2,
);
check(
  "the style ref matches through styleKey",
  piecesPerPack(LINES, ABC, "  grils t shirt "),
  4,
);

// ---------------------------------------------------------------------------
// ROWS MID-ANSWER, AND ROWS THAT SHOULD NOT EXIST
// ---------------------------------------------------------------------------

const PARTIAL: PackTypeLineLike[] = [
  { pack_type: ABC, style_ref_no: TEE, combo: "WHITE", qty: 2 },
  // Named, not yet quantified: the operator is standing in this row.
  { pack_type: ABC, style_ref_no: TEE, combo: "GREEN", qty: "" },
];

check(
  "a named colourway with no quantity reads 0, so the pack UNDER-reads",
  piecesPerPack(PARTIAL, ABC, TEE),
  2,
);
check(
  "...and contributes no cells when exploded",
  explodePacks(PARTIAL, ABC, TEE, new Map([[S, 10]])),
  [{ combo: "WHITE", size_id: S, qty: 20 }],
);

// `lib/data-io` writes straight to Postgres and a document saved before
// `uq_goa_pack_type_lines_member` existed can hold the same member twice.
const DOUBLED: PackTypeLineLike[] = [
  { pack_type: ABC, style_ref_no: TEE, combo: "WHITE", qty: 1 },
  { pack_type: ABC, style_ref_no: TEE, combo: "white", qty: 3 },
];
check(
  "a repeated colourway is ONE member, summed",
  packContents(DOUBLED, ABC, TEE),
  [{ combo: "WHITE", qty: 4 }],
);

check(
  "a method with no lines explodes to nothing",
  explodePacks(LINES, "NO SUCH METHOD", TEE, new Map([[S, 1000]])),
  [],
);
check(
  "...and reports null rather than 0 pieces",
  totalPiecesFromPacks(LINES, "NO SUCH METHOD", TEE, new Map([[S, 1000]])),
  null,
);
check(
  "another style's boxes are not this style's pieces",
  piecesPerPack(LINES, ABC, "SOME OTHER STYLE"),
  0,
);

// A pack whose every line is blank cannot be exploded, and must not read as an
// order for zero garments — the `derivedPoQty` rule, restated one module over.
const BLANK: PackTypeLineLike[] = [
  { pack_type: ABC, style_ref_no: TEE, combo: "WHITE", qty: "" },
];
check(
  "a composition of blank quantities is not an explosion",
  totalPiecesFromPacks(BLANK, ABC, TEE, new Map([[S, 100]])),
  null,
);

console.log(
  failed
    ? `\n${failed} pack-type-explosion vector(s) FAILED`
    : "\nall pack-type-explosion vectors pass",
);
process.exit(failed ? 1 : 0);
