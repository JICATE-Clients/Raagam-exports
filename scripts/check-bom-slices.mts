/**
 * Vectors for `lib/orders/material-bom/slice-consumption.ts` (0442) — what one
 * slice of a Material BOM line consumes when the operator has overridden some
 * of them and not others.
 *
 * ## WHAT IS ACTUALLY AT RISK HERE
 *
 * The store is SPARSE: a missing row means "use the line's figure". So every
 * interesting case is an absence, and an absence read wrongly does not throw —
 * it quietly buys the wrong number of buttons. The three shapes that must not
 * collapse into each other:
 *
 *   no override at all   -> both figures come from the line
 *   one figure typed     -> that one wins, the OTHER still comes from the line
 *   both typed           -> neither comes from the line
 *
 * §2 is the one that would go unnoticed. `?? line` applied to the ROW rather
 * than to each FIELD looks correct, passes a one-figure test, and silently
 * reads `per_pieces` as null on a slice where only `no_of_items` was typed —
 * which refuses the slice instead of inheriting.
 *
 * Run: `npm run check:bom-slices`.
 */
import {
  consumptionFor,
  liveOverrides,
  overrideFor,
  sliceKey,
  type SliceOverride,
} from "../lib/orders/material-bom/slice-consumption.ts";
import { requirementFor } from "../lib/orders/material-bom/requirement.ts";

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

const S = "size-s";
const M = "size-m";
const L = "size-l";

/* THE THIRD FIELD ARRIVED 0450. `consumptionFor` composes the wastage buffer
   beside the ratio now — the client moved all three off the line together — so
   every "comes from the line" expectation carries it. NULL is still inherit. */
const LINE = { no_of_items: 2, per_pieces: 1, excess_pct: null };

const ov = (
  combo: string | null,
  size_id: string | null,
  no_of_items: number | null,
  per_pieces: number | null,
): SliceOverride => ({ combo, size_id, no_of_items, per_pieces });

const at = (combo: string | null, size_id: string | null) => ({ combo, size_id });

console.log("\n§1  No override — the line's figures reach every slice");

check("both come from the line", consumptionFor(LINE, [], at(null, S)), LINE);
check("a null store is the same as an empty one", consumptionFor(LINE, null, at(null, S)), LINE);
check(
  "an override for a DIFFERENT slice does not leak",
  consumptionFor(LINE, [ov(null, M, 9, 9)], at(null, S)),
  LINE,
);

console.log("\n§2  One figure typed — the OTHER still inherits");

check(
  "only no_of_items typed: per_pieces still comes from the line",
  consumptionFor(LINE, [ov(null, L, 5, null)], at(null, L)),
  { no_of_items: 5, per_pieces: 1, excess_pct: null },
);
check(
  "only per_pieces typed: no_of_items still comes from the line",
  consumptionFor(LINE, [ov(null, L, null, 4)], at(null, L)),
  { no_of_items: 2, per_pieces: 4, excess_pct: null },
);
// THE REGRESSION, named. `override ?? line` on the ROW returns the override
// whole, so the untyped half arrives as null — which refuses the slice.
check(
  "the untyped half is never null",
  consumptionFor(LINE, [ov(null, L, 5, null)], at(null, L)).per_pieces === null,
  false,
);

console.log("\n§3  Both typed — nothing comes from the line");

check(
  "the override wins outright",
  consumptionFor(LINE, [ov(null, L, 7, 3)], at(null, L)),
  { no_of_items: 7, per_pieces: 3, excess_pct: null },
);
// A ZERO IS AN ANSWER, not an absence — `||` here would silently inherit.
check(
  "a zero no_of_items is honoured, not treated as blank",
  consumptionFor(LINE, [ov(null, L, 0, 2)], at(null, L)),
  { no_of_items: 0, per_pieces: 2, excess_pct: null },
);

console.log("\n§4  The key — combo AND size, case-insensitively");

check(
  "a colour-wise override matches on the combo alone",
  consumptionFor(LINE, [ov("WHITE", null, 6, 1)], at("WHITE", null)),
  { no_of_items: 6, per_pieces: 1, excess_pct: null },
);
check(
  "case and padding do not break the match",
  consumptionFor(LINE, [ov(" white ", null, 6, 1)], at("WHITE", null)),
  { no_of_items: 6, per_pieces: 1, excess_pct: null },
);
check(
  "a combination override needs BOTH to agree",
  consumptionFor(LINE, [ov("WHITE", L, 8, 1)], at("WHITE", L)),
  { no_of_items: 8, per_pieces: 1, excess_pct: null },
);
check(
  "same colour, different size, is a different slice",
  consumptionFor(LINE, [ov("WHITE", L, 8, 1)], at("WHITE", M)),
  LINE,
);
check(
  "same size, different colour, is a different slice",
  consumptionFor(LINE, [ov("WHITE", L, 8, 1)], at("NAVY", L)),
  LINE,
);
// A null axis is a VALUE ("this basis has no colour"), not a wildcard.
check(
  "an order-wise override does not answer a colour-wise slice",
  consumptionFor(LINE, [ov(null, null, 8, 1)], at("WHITE", null)),
  LINE,
);
// THREE AXES SINCE 0449 — the destination joined combo and size. The trailing
// empty segment is a basis with no destination axis, and it must be PRESENT
// rather than trimmed: dropping it would make "NAVY:M" and "NAVY:M:USA" differ
// only by a suffix, and a future fourth axis would collide with this one.
check("the key normalises every half", sliceKey(at(" navy ", M)), `NAVY:${M}:`);

console.log("\n§5  overrideFor returns the row, or null");

check("found", overrideFor([ov("WHITE", null, 6, 1)], at("WHITE", null))?.no_of_items, 6);
check("not found is null, never undefined", overrideFor([], at("WHITE", null)), null);

console.log("\n§6  liveOverrides — the grid follows the order exactly");

const stored = [ov("WHITE", S, 1, 1), ov("WHITE", M, 2, 1), ov("WHITE", L, 3, 1)];
check(
  "an override whose size the order dropped is not kept",
  liveOverrides(stored, [at("WHITE", S), at("WHITE", M)]).map((o) => o.size_id),
  [S, M],
);
check(
  "everything still on the order survives",
  liveOverrides(stored, [at("WHITE", S), at("WHITE", M), at("WHITE", L)]).length,
  3,
);
check("nothing live keeps nothing", liveOverrides(stored, []).length, 0);
check("a null store is an empty list, never a throw", liveOverrides(null, []), []);

// ---------------------------------------------------------------------------
// THE COMPOSITION THE SERVER HAS TO PERFORM
//
// Everything above tests `consumptionFor` in isolation, and it has always been
// right. What shipped wrong is that NOBODY CALLED IT on the way to storage: the
// screen composed the line through it (`mba-master-screen.tsx`) and
// `requirementRows` in `actions.ts` passed the line's raw figures straight to
// `requirementFor`. So an operator who typed an override saw one number and
// stored a different one — and the stored one is what a purchase order is
// checked against.
//
// A pure vector cannot reach a server action, so this asserts the COMPOSITION
// rather than the action: the two calls must disagree, which is what makes
// calling the right one matter. If these two ever return the same figure the
// test below is vacuous and the override feature is doing nothing.
// ---------------------------------------------------------------------------

const composedSlice = { combo: "WHITE", size_id: L, key: "", label: "L", qty: 100, style_ref_no: null };
const overrides = [ov("WHITE", L, 5, 1)];
const lineOnly = requirementFor({ ...LINE, excess_pct: 0, decimals: 2 }, composedSlice);
const composed = requirementFor(
  { ...consumptionFor(LINE, overrides, composedSlice), excess_pct: 0, decimals: 2 },
  composedSlice,
);

check("the line's own figures give 2 per piece", lineOnly, 200);
check("the override gives 5 per piece, and this is what must be STORED", composed, 500);
check("the two genuinely differ, so calling the right one matters", lineOnly !== composed, true);

// A slice with NO override must come out identical either way — otherwise
// wiring the composition in would move every untouched line in the system.
const plainSlice = { combo: "WHITE", size_id: M, key: "", label: "M", qty: 100, style_ref_no: null };
check(
  "a slice with no override is untouched by the composition",
  requirementFor(
    { ...consumptionFor(LINE, overrides, plainSlice), excess_pct: 0, decimals: 2 },
    plainSlice,
  ),
  requirementFor({ ...LINE, excess_pct: 0, decimals: 2 }, plainSlice),
);

// ---------------------------------------------------------------------------
// §7  THE DESTINATION IS PART OF THE KEY (0449)
//
// A country-wise line whose rows go size-wise produces slices with NO combo and
// a size — so USA·M and CH·M were byte-identical under a key of (combo, size).
// One destination's typed figure answered for the other, silently, on the number
// a purchase order is written from.
//
// The requirement table has keyed on country_id since 0444. This is the override
// store catching up; until it does, the two disagree about what one row IS.
// ---------------------------------------------------------------------------

const USA = "country-usa";
const CHN = "country-chn";
const atC = (country: string | null, size_id: string | null) => ({
  combo: null,
  size_id,
  country_id: country,
});
const ovC = (
  country: string | null,
  size_id: string | null,
  no_of_items: number | null,
): SliceOverride => ({ combo: null, size_id, country_id: country, no_of_items, per_pieces: null });

check(
  "USA's size override does not answer for CH",
  consumptionFor(LINE, [ovC(USA, L, 9)], atC(CHN, L)),
  LINE,
);
check(
  "…and it still answers for USA",
  consumptionFor(LINE, [ovC(USA, L, 9)], atC(USA, L)),
  { no_of_items: 9, per_pieces: 1, excess_pct: null },
);
check(
  "two destinations at one size are two keys",
  sliceKey(atC(USA, L)) === sliceKey(atC(CHN, L)),
  false,
);
// A basis with NO destination axis leaves it null on BOTH sides, and null must
// still match null — the same rule combo and size already follow.
check(
  "a colour-wise override is unaffected by the new axis",
  consumptionFor(LINE, [ov("WHITE", null, 6, 1)], at("WHITE", null)),
  { no_of_items: 6, per_pieces: 1, excess_pct: null },
);
check(
  "an override with no destination does not answer a destination row",
  consumptionFor(LINE, [ovC(null, L, 9)], atC(USA, L)),
  LINE,
);

console.log(
  failed === 0
    ? "\nOK — every BOM slice vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
