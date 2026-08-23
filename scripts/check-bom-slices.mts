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
  toOverrides,
  OVERRIDE_FIELDS,
  type SliceOverride,
} from "../lib/orders/material-bom/slice-consumption.ts";
import { requirementFor } from "../lib/orders/material-bom/requirement.ts";
import { mbaItemInput } from "../lib/orders/material-bom-amendment/types.ts";

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

/** Asserts a value is NOT something — for the wrong answer a plausible
 *  implementation gives. The same helper the requirement vectors carry. */
function refute(label: string, actual: unknown, notExpected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(notExpected)) {
    failed++;
    console.log(`  FAIL  ${label}\n          must not be ${JSON.stringify(notExpected)}`);
  } else {
    console.log(`  ok    ${label}`);
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

// ---------------------------------------------------------------------------
// The SAVE PATH — what the server actually stores (fixed 2026-08-23)
// ---------------------------------------------------------------------------
/**
 * Three defects shipped together in `7c8b6b4`, all in `writeChildren`'s
 * neighbourhood and all of the same shape: a literal that names fewer fields
 * than the thing it describes. None produced a type error, and two of them made
 * the screen and the server disagree about a figure a purchase order is checked
 * against.
 *
 * The column half is proved against the live catalog (a rolled-back round trip,
 * 2026-08-23: all 13 writable columns stored and read back). What is asserted
 * HERE is the half that is pure — the override lookup and the duplicate guard.
 */

console.log("\n§  the save path: an override must resolve on the axes it was keyed by");

/*
 * DEFECT 2. `actions.ts` normalised each stored override into a literal naming
 * `combo`, `size_id` and the two figures — dropping `country_id` and
 * `excess_pct`. `sliceKey` reads all three axes, so on a country-wise line the
 * operator's figure was accepted, saved, redrawn by the same `consumptionFor`
 * on screen, and NEVER reached the stored requirement.
 *
 * These vectors describe the normalisation's SHAPE rather than calling it (it is
 * inline in the action): an override missing its destination must not answer a
 * destination row. Break the shape and the first two fail.
 */
const LINE_D = { no_of_items: 2, per_pieces: 1, excess_pct: 1 };
const US_D = "aaaaaaaa-0000-4000-8000-000000000001";

/**
 * THE REAL NORMALISER, not a copy of its shape.
 *
 * `toOverrides` is what `writeChildren` calls, so these vectors fail if the
 * shipped function drops a field. Testing a locally-rebuilt literal would have
 * asserted the RULE while leaving the code free to break it — which is exactly
 * the state this defect shipped in.
 */
const carried = toOverrides([
  { combo: "WHITE", size_id: null, country_id: US_D, no_of_items: 9, per_pieces: null, excess_pct: 12 },
]);
/** What the inline literal built before the fix — two axes dropped. */
const dropped = carried.map((o) => ({
  combo: o.combo,
  size_id: o.size_id,
  no_of_items: o.no_of_items,
  per_pieces: o.per_pieces,
}));

/*
 * THE WHOLE KEY SET, not a spot-check. The defect was a MISSING key, and a
 * vector that reads `o.country_id` only proves the one field it names — the next
 * field to be dropped would sail past it. Comparing the sorted key list is what
 * makes "every field arrives" a single assertion that cannot rot.
 */
check(
  "toOverrides emits every field an override carries",
  Object.keys(carried[0]).sort(),
  [...OVERRIDE_FIELDS].sort(),
);
check(
  "...and undefined is normalised to null, never left to key as \"\"",
  toOverrides([{ combo: "WHITE" }])[0],
  { combo: "WHITE", size_id: null, country_id: null, no_of_items: null, per_pieces: null, excess_pct: null },
);
check("a null store is an empty list, never a throw", toOverrides(null), []);

const usaRow = { combo: "WHITE", size_id: null, country_id: US_D };

check(
  "a carried override answers its own destination row",
  consumptionFor(LINE_D, carried, usaRow).no_of_items,
  9,
);
check(
  "...and its wastage reaches the server too (0450)",
  consumptionFor(LINE_D, carried, usaRow).excess_pct,
  12,
);
/* THE REGRESSION ITSELF. With the destination dropped the override keys as ""
   and matches nothing, so the LINE's figure is stored instead — silently, and
   beside a screen showing 9. */
check(
  "an override stripped of its destination silently falls back to the line",
  consumptionFor(LINE_D, dropped, usaRow).no_of_items,
  2,
);
refute(
  "...which is NOT the figure the operator typed",
  consumptionFor(LINE_D, dropped, usaRow).no_of_items,
  9,
);
check(
  "and a stripped excess_pct falls back to the line's, never the row's",
  consumptionFor(LINE_D, dropped, usaRow).excess_pct,
  1,
);

/* THE FIX MUST NOT OVER-REACH EITHER: carrying the destination must not make an
   override answer a DIFFERENT one. That is the collision 0449 added the axis to
   prevent, and it stays prevented. */
const CH_D = "aaaaaaaa-0000-4000-8000-000000000002";
check(
  "USA's override still does not answer CH",
  consumptionFor(LINE_D, carried, { combo: "WHITE", size_id: null, country_id: CH_D }).no_of_items,
  2,
);

console.log("\n§  the save path: two destinations at one size are not duplicates");

/*
 * DEFECT 3. `mbaItemInput`'s duplicate guard keyed on `${combo}:${size_id}`
 * while `uq_mba_slice_line_combo_size` has keyed on all THREE axes since 0449 —
 * which that migration even asserts ("USA-M and CH-M would collide").
 *
 * The drift ran the OPPOSITE way to the one its own comment feared: not the form
 * accepting a pair the database refuses, but the form REFUSING a pair the
 * database allows. A country-wise line with a figure against two destinations at
 * one size could not be saved at all.
 */
const sliceOf = (over: Record<string, unknown>) => ({
  combo: "WHITE",
  size_id: null,
  country_id: null,
  no_of_items: 5,
  ...over,
});
const lineWith = (slices: unknown[]) => ({
  item_id: "11111111-1111-4111-8111-111111111111",
  no_of_items: 2,
  per_pieces: 1,
  requirement_basis: "country",
  slices,
});

const twoDestinations = mbaItemInput.safeParse(lineWith([
  sliceOf({ country_id: US_D }),
  sliceOf({ country_id: CH_D }),
]));
check("two destinations at one size SAVE", twoDestinations.success, true);

/* AND A REAL DUPLICATE IS STILL REFUSED, with the sentence rather than a
   Postgres constraint name. Widening a key must not disarm the guard. */
const realDuplicate = mbaItemInput.safeParse(lineWith([
  sliceOf({ country_id: US_D }),
  sliceOf({ country_id: US_D }),
]));
check("the same destination twice is still refused", realDuplicate.success, false);
/* AND FOR THE RIGHT REASON. `success === false` alone is a false green — the
   first draft of this vector passed because its uuids were malformed, not
   because the guard fired. So every refusal here names the issue it expects. */
const dupMsg = (r: typeof realDuplicate) =>
  r.success ? [] : r.error.issues.map((i) => i.message);
check(
  "...and it says so in words",
  realDuplicate.success
    ? null
    : realDuplicate.error.issues.some((i) => i.message === "This slice already has an override on the line"),
  true,
);
/* The no-destination case is unchanged: two rows with a null country are still
   one slice, because a NULL is a value and two nulls collide (the index
   COALESCEs it to a sentinel for exactly that reason). */
const twoNulls = mbaItemInput.safeParse(lineWith([sliceOf({}), sliceOf({})]));
check("two rows with no destination are still one slice", twoNulls.success, false);
check(
  "...and that too is the duplicate guard, not a malformed fixture",
  dupMsg(twoNulls).includes("This slice already has an override on the line"),
  true,
);

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
