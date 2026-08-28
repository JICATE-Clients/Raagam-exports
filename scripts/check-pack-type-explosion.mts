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
  memberKey,
  packContents,
  packStyles,
  packsStyle,
  piecesOfComboPerPack,
  piecesPerPack,
  totalPiecesFromPacks,
  type PackTypeLineLike,
} from "../lib/orders/amendments/pack-type-explosion.ts";

let failed = 0;

/** Asserts a value is NOT something — the wrong answer a plausible
 *  implementation gives. Same helper the sibling suites carry. */
function refute(what: string, got: unknown, notWant: unknown) {
  if (JSON.stringify(got) === JSON.stringify(notWant)) {
    failed++;
    console.log(`FAIL  ${what}
        must not be ${JSON.stringify(notWant)}`);
  } else {
    console.log(`ok    ${what}`);
  }
}

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
    { style_ref_no: TEE, combo: "WHITE", qty: 1 },
    { style_ref_no: TEE, combo: "GREEN", qty: 1 },
    { style_ref_no: TEE, combo: "BLACK", qty: 2 },
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
    { style_ref_no: TEE, combo: "WHITE", size_id: S, qty: 1000 },
    { style_ref_no: TEE, combo: "GREEN", size_id: S, qty: 1000 },
    { style_ref_no: TEE, combo: "BLACK", size_id: S, qty: 2000 },
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
    { style_ref_no: TEE, combo: "WHITE", size_id: S, qty: 100 },
    { style_ref_no: TEE, combo: "GREEN", size_id: S, qty: 100 },
    { style_ref_no: TEE, combo: "BLACK", size_id: S, qty: 200 },
    { style_ref_no: TEE, combo: "WHITE", size_id: M, qty: 200 },
    { style_ref_no: TEE, combo: "GREEN", size_id: M, qty: 200 },
    { style_ref_no: TEE, combo: "BLACK", size_id: M, qty: 400 },
  ],
);

// A SIZE NOT ORDERED IS NOT A ROW OF ZEROS. The balance rule reads stored cells
// back, so an explicit 0 is a claim about a size the operator said nothing about.
check(
  "a size with no boxes yields no cells at all",
  explodePacks(LINES, ABC, TEE, new Map([[S, 100], [M, 0]])),
  [
    { style_ref_no: TEE, combo: "WHITE", size_id: S, qty: 100 },
    { style_ref_no: TEE, combo: "GREEN", size_id: S, qty: 100 },
    { style_ref_no: TEE, combo: "BLACK", size_id: S, qty: 200 },
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
  [{ style_ref_no: TEE, combo: "WHITE", size_id: S, qty: 20 }],
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
  [{ style_ref_no: TEE, combo: "WHITE", qty: 4 }],
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

// ---------------------------------------------------------------------------
// THE MULTI-STYLE BOX (client 2026-08-28)
//
//   "A single box containing garment items of DIFFERENT styles — for example a
//    baby gift set with 1 full-sleeve, 1 half-sleeve and 1 sleeveless bodysuit."
//
//   100 boxes of Size S must become 100 + 100 + 100 = 300 pieces, split across
//   three distinct styles.
//
// THIS IS WHAT THE MODULE COULD NOT DO. The composition was keyed on the
// COLOURWAY and took the style as a mandatory filter, so it modelled "several
// colours of ONE style". A three-style box exploded into one third of itself,
// and on an order declaring several styles `inheritedStyleFor` resolves to no
// style at all, so it exploded into NOTHING — the boxes row never appeared and
// the destination silently fell back to typed piece counts.
//
// THE STORAGE NEVER NEEDED CHANGING: `pack_type_lines` has carried
// `style_ref_no` per line since 0472. The style was thrown away on the way out.
// ---------------------------------------------------------------------------

const BOX = "BABY GIFT BOX";
const FULL = "STL/26-27/0101";
const HALF = "STL/26-27/0102";
const SLEEVELESS = "STL/26-27/0103";

const GIFT: PackTypeLineLike[] = [
  { pack_type: BOX, style_ref_no: FULL, combo: "BLUE", qty: 1 },
  { pack_type: BOX, style_ref_no: HALF, combo: "BLUE", qty: 1 },
  { pack_type: BOX, style_ref_no: SLEEVELESS, combo: "BLUE", qty: 1 },
];

check("the box holds three garments across three styles", piecesPerPack(GIFT, BOX), 3);
check("and names the three styles, in composition order", packStyles(GIFT, BOX), [
  FULL,
  HALF,
  SLEEVELESS,
]);
check(
  "the composition is three members, each carrying its own style",
  packContents(GIFT, BOX),
  [
    { style_ref_no: FULL, combo: "BLUE", qty: 1 },
    { style_ref_no: HALF, combo: "BLUE", qty: 1 },
    { style_ref_no: SLEEVELESS, combo: "BLUE", qty: 1 },
  ],
);

// THE CLIENT'S WORKED NUMBERS.
check(
  "100 boxes become 100 + 100 + 100 pieces, one row per style",
  explodePacks(GIFT, BOX, null, new Map([[S, 100]])),
  [
    { style_ref_no: FULL, combo: "BLUE", size_id: S, qty: 100 },
    { style_ref_no: HALF, combo: "BLUE", size_id: S, qty: 100 },
    { style_ref_no: SLEEVELESS, combo: "BLUE", size_id: S, qty: 100 },
  ],
);
check(
  "...which is 300 pieces, not 100",
  totalPiecesFromPacks(GIFT, BOX, null, new Map([[S, 100]])),
  300,
);
// THE REGRESSION AS ITSELF. Keyed on the colourway alone, all three members are
// "BLUE" and collapse into one — 100 pieces of a garment nobody can name, and
// two styles cut and stitched for nothing.
refute(
  "three styles sharing a colourway must NOT collapse into one member",
  packContents(GIFT, BOX).length,
  1,
);
check(
  "...and their member keys are genuinely distinct",
  new Set(packContents(GIFT, BOX).map((c) => memberKey(c.style_ref_no, c.combo))).size,
  3,
);

// NARROWING STILL WORKS, which is what keeps every single-style caller correct.
check("naming a style narrows to it", piecesPerPack(GIFT, BOX, HALF), 1);
check(
  "...and returns only that style's members",
  packContents(GIFT, BOX, HALF),
  [{ style_ref_no: HALF, combo: "BLUE", qty: 1 }],
);
check("a style the box does not pack is nothing", piecesPerPack(GIFT, BOX, TEE), 0);

// `packsStyle` is what the order screen resolves a destination's method by.
check("the box packs the half-sleeve", packsStyle(GIFT, BOX, HALF), true);
check("it does not pack the tee", packsStyle(GIFT, BOX, TEE), false);
// A BLANK REF ASKS ABOUT NO STYLE, so it is false rather than vacuously true —
// otherwise every method would "cover" every destination and the screen would
// resolve an ambiguous order to whichever method it looked at first.
check("a blank ref is not a style the box packs", packsStyle(GIFT, BOX, ""), false);
// ...but a blank ref on the CONTENTS means "every style", which is what a
// multi-style box is. The two blanks mean opposite things on purpose: one asks
// "is this style in the box", the other says "do not narrow the box".
check("a blank ref does not narrow the composition", packContents(GIFT, BOX, "").length, 3);

// A MIXED PACK: two styles, one of them in two colourways. The member count is
// what tells the difference between this and a four-colour single-style pack.
const MIXED: PackTypeLineLike[] = [
  { pack_type: BOX, style_ref_no: FULL, combo: "BLUE", qty: 1 },
  { pack_type: BOX, style_ref_no: FULL, combo: "PINK", qty: 1 },
  { pack_type: BOX, style_ref_no: HALF, combo: "BLUE", qty: 2 },
];
check("a mixed box counts every member", piecesPerPack(MIXED, BOX), 4);
check("the full-sleeve contributes two of them", piecesPerPack(MIXED, BOX, FULL), 2);
check(
  "BLUE means two different garments here, and stays two rows",
  explodePacks(MIXED, BOX, null, new Map([[S, 10]])).filter((c) => c.combo === "BLUE"),
  [
    { style_ref_no: FULL, combo: "BLUE", size_id: S, qty: 10 },
    { style_ref_no: HALF, combo: "BLUE", size_id: S, qty: 20 },
  ],
);

console.log(
  failed
    ? `\n${failed} pack-type-explosion vector(s) FAILED`
    : "\nall pack-type-explosion vectors pass",
);
process.exit(failed ? 1 : 0);
