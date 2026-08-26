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
  combinationNames,
  consumptionFor,
  crossCombinations,
  liveOverrides,
  orphanedOverrides,
  overrideFor,
  sliceKey,
  toOverrides,
  OVERRIDE_FIELDS,
  KEY_AXES,
  type SliceOverride,
} from "../lib/orders/material-bom/slice-consumption.ts";
import { requirementFor } from "../lib/orders/material-bom/requirement.ts";
import { mbaItemInput, missingItemFields } from "../lib/orders/material-bom-amendment/types.ts";

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

/*
 * AND THE SAME ARGUMENT FOR `KEY_AXES`, which is a SECOND hand-maintained list
 * of the same fact. `liveOverrides` mutes the axes a live set does not speak by
 * walking it, so an axis that is in `sliceKey` and not in this list can never be
 * muted — the grain-collapse ruling would then quietly fail on that one axis,
 * which is precisely the shape 0449, 0463 and 0464 each arrived as.
 *
 * Asserted two ways, because neither is sufficient alone: the key really is made
 * of exactly this many segments, and every axis named really does move the key.
 * A list that named a field `sliceKey` ignores would pass the count and fail the
 * second; a list missing a real axis fails the first.
 */
check(
  "sliceKey is built from exactly KEY_AXES.length axes",
  sliceKey({ combo: null, size_id: null, country_id: null }).split(":").length,
  KEY_AXES.length,
);
for (const axis of KEY_AXES) {
  const blank = { combo: null, size_id: null, country_id: null, combination: null, style_ref_no: null };
  refute(
    `sliceKey reads ${axis}, so muting it is meaningful`,
    sliceKey({ ...blank, [axis]: "X" }),
    sliceKey(blank),
  );
}
check(
  "...and undefined is normalised to null, never left to key as \"\"",
  toOverrides([{ combo: "WHITE" }])[0],
  {
    combo: "WHITE",
    size_id: null,
    country_id: null,
    combination: null,
    style_ref_no: null,
    no_of_items: null,
    per_pieces: null,
    excess_pct: null,
  },
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
  /* CATEGORY IS REQUIRED SINCE 2026-08-24 (client). The fixture carries one
     because these vectors are about the SLICE rules — a line refused for a
     missing category would make them pass or fail for a reason that has nothing
     to do with what they assert. That is the same trap the malformed-uuid draft
     of these vectors fell into. */
  category_id: "22222222-2222-4222-8222-222222222222",
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
// FIVE AXES SINCE 0464 — the style joined combo, size, the destination and the
// typed combination. Every trailing empty segment must be PRESENT rather than
// trimmed: dropping them would make "NAVY:M" and "NAVY:M:USA" differ only by a
// suffix, and the next axis added would collide with this one.
check("the key normalises every half", sliceKey(at(" navy ", M)), `NAVY:${M}:::`);

// ---------------------------------------------------------------------------
// THE COLLISION 0463 EXISTS TO PREVENT.
//
// A combination row is created by typing a NAME in the Combination popup, and
// carries no combo, no size and no country of its own. So before the axis was
// part of the key, TOP and BOTTOM both keyed as "::" — and `overrideFor` is a
// `.find()`, so the first row would have answered for both, on the figure a
// purchase order is written from.
//
// Verified by making it FAIL first: with `combination` removed from `sliceKey`,
// both keys are "::" and the two checks below report equal keys and TOP's
// figure answering BOTTOM's row.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// THE COLLISION 0464 FIXED, AND IT WAS LIVE.
//
// A style-basis row carries `style_ref_no` and nothing else — combo, size and
// country are all NULL (`productionSlices`, the `basis === "style"` branch). So
// before 0464 every style on the line keyed as ":::" and a figure typed against
// one answered for all of them, on the number a purchase order is written from.
// Invisible on a single-style order, which is why it survived since 0440.
//
// Verified by making it FAIL first: with `style_ref_no` removed from
// `sliceKey`, the two keys are equal and STYLE B reports STYLE A's 5.
// ---------------------------------------------------------------------------
const ST_A = { combo: null, size_id: null, country_id: null, style_ref_no: "STL/26-27/0001" };
const ST_B = { combo: null, size_id: null, country_id: null, style_ref_no: "STL/26-27/0002" };

check("two styles on one line are two keys", sliceKey(ST_A) !== sliceKey(ST_B), true);
check("a style ref normalises like every other half", sliceKey({ ...ST_A, style_ref_no: " stl/26-27/0001 " }), sliceKey(ST_A));
check(
  "one style's figure does not answer the other's row",
  overrideFor([{ ...ST_A, no_of_items: 5, per_pieces: 1 }], ST_B),
  null,
);
check(
  "...and it still answers its own",
  overrideFor([{ ...ST_A, no_of_items: 5, per_pieces: 1 }], ST_A)?.no_of_items,
  5,
);
// THE TWO AXES ARE INDEPENDENT. A style-wise line split by garment part is the
// cross product, and all four rows must be distinguishable — this is the case
// the 0463 column made reachable, so it is the case most likely to regress.
check(
  "style x combination is four distinct keys",
  new Set([
    sliceKey({ ...ST_A, combination: "TOP" }),
    sliceKey({ ...ST_A, combination: "BOTTOM" }),
    sliceKey({ ...ST_B, combination: "TOP" }),
    sliceKey({ ...ST_B, combination: "BOTTOM" }),
  ]).size,
  4,
);
check(
  "the same part on another style is not the same row",
  overrideFor([{ ...ST_A, combination: "TOP", no_of_items: 5, per_pieces: 1 }], {
    ...ST_B,
    combination: "TOP",
  }),
  null,
);

const TOP = { combo: null, size_id: null, country_id: null, combination: "TOP" };
const BOTTOM = { combo: null, size_id: null, country_id: null, combination: "BOTTOM" };

check("two garment parts on one line are two keys", sliceKey(TOP) !== sliceKey(BOTTOM), true);
check("a typed name normalises like every other half", sliceKey({ ...TOP, combination: " top " }), sliceKey(TOP));
check(
  "one part's figure does not answer the other's row",
  overrideFor(
    [{ ...TOP, no_of_items: 4, per_pieces: 1 }],
    BOTTOM,
  ),
  null,
);
check(
  "...and it still answers its own",
  overrideFor([{ ...TOP, no_of_items: 4, per_pieces: 1 }], TOP)?.no_of_items,
  4,
);
check(
  "a plain slice is not a combination row",
  sliceKey({ combo: null, size_id: null, country_id: null }) !== sliceKey(TOP),
  true,
);

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

/*
 * THE COMBINATION AXIS DOES NOT COME FROM THE ORDER, AND FILTERING BY IT DELETED
 * THE OPERATOR'S TYPING (2026-08-25).
 *
 * `sliceKey` has five axes and four of them are the order's. A garment part is
 * typed on the LINE, in the Combination popup, so a live set built from
 * `productionSlices` mentions none — and every stored combination row matched
 * nothing. This filter runs on the way OUT, so those rows were not ignored, they
 * were never written: type TOP and BOTTOM, save, reopen, gone.
 *
 * Made to fail first against the pre-fix function: 5 rows in, 1 kept.
 */
const withParts = [
  { combo: "WHITE", size_id: null, country_id: null, combination: "TOP", style_ref_no: "S1" },
  { combo: "NAVY", size_id: null, country_id: null, combination: "TOP", style_ref_no: "S1" },
  { combo: "WHITE", size_id: null, country_id: null, combination: "BOTTOM", style_ref_no: "S1" },
  { combo: "WHITE", size_id: null, country_id: null, combination: null, style_ref_no: "S1" },
];
/* The live set a server builds today — the order's own axes, no combination. */
const liveNoParts = [
  { combo: "WHITE", size_id: null, country_id: null, style_ref_no: "S1" },
  { combo: "NAVY", size_id: null, country_id: null, style_ref_no: "S1" },
];
check(
  "a live set that names no combination cannot vote to delete one",
  liveOverrides(withParts, liveNoParts).length,
  4,
);
refute(
  "...it does NOT keep only the plain row",
  liveOverrides(withParts, liveNoParts).length,
  1,
);

/* THE CLIENT'S RULE SURVIVES ON THE AXES THE ORDER DOES OWN. Only the
   combination half of the key is excused — a part typed against a colourway the
   order has dropped still goes, or "the grid follows the order exactly" would
   have become "except on any line with a combination". */
check(
  "a combination row whose COLOURWAY has gone is still dropped",
  liveOverrides(withParts, [liveNoParts[0]]).map((o) => `${o.combo}/${o.combination ?? "-"}`),
  ["WHITE/TOP", "WHITE/BOTTOM", "WHITE/-"],
);

/* AND IT SELF-DISABLES. The moment a caller crosses its slices by combination —
   the screen already does — the live set expresses the axis, the full five-way
   comparison applies again, and a name removed from the popup takes its rows
   with it. Otherwise this would be a permanent hole rather than a stood-down
   axis. */
check(
  "a live set that DOES name combinations adjudicates them again",
  liveOverrides(withParts, [
    { combo: "WHITE", size_id: null, country_id: null, combination: "TOP", style_ref_no: "S1" },
  ]).map((o) => `${o.combo}/${o.combination ?? "-"}`),
  ["WHITE/TOP"],
);

/*
 * §6b  A GRAIN COLLAPSE KEEPS THE FIGURES IT BYPASSES (client ruling 2026-08-25)
 *
 * A SEPARATE BYPASS FROM THE COMBINATION ONE ABOVE, and it is about the LINE
 * changing rather than the order. Switch a line's Attribute from Colour-wise to
 * Whole order and the live set collapses to a single keyless slice, so every
 * colour-keyed figure matches nothing and `consumptionFor` inherits the line's
 * own ratio in its place.
 *
 * IT USED TO DELETE THEM AT SAVE — 2 typed, 0 written. The client was offered
 * keep / prompt / refuse and chose KEEP, so the axis a collapsed grain no longer
 * speaks now stands down and nothing is orphaned. These two vectors were
 * INVERTED in the same edit as the rule, never left behind:
 *
 *     a collapse to whole-order orphans every colour-keyed figure  ->  orphans NOTHING
 *
 * The bypass is still reported to the operator — the advisory beside the
 * Attribute says those figures are not counted under this grain — but it is a
 * warning now rather than a deletion notice.
 */
const colourTyped = [
  { combo: "WHITE", size_id: null, country_id: null, combination: null, style_ref_no: "S1" },
  { combo: "NAVY", size_id: null, country_id: null, combination: null, style_ref_no: "S1" },
];
const colourLive = [
  { combo: "WHITE", size_id: null, country_id: null, style_ref_no: "S1" },
  { combo: "NAVY", size_id: null, country_id: null, style_ref_no: "S1" },
];
/* The whole-order grain: one slice with no axis at all. */
const orderLive = [{ combo: null, size_id: null, country_id: null, style_ref_no: null }];

check(
  "while the grain still holds them, nothing is orphaned",
  orphanedOverrides(colourTyped, colourLive).length,
  0,
);
check(
  "a collapse to whole-order orphans NOTHING — the ruling is keep",
  orphanedOverrides(colourTyped, orderLive).map((o) => o.combo),
  [],
);
check(
  "...and every bypassed figure is written, so switching back reaches it",
  liveOverrides(colourTyped, orderLive).map((o) => o.combo),
  ["WHITE", "NAVY"],
);
/* THE CASE THAT WOULD MAKE THE GENERALISATION WRONG, and the reason it is not a
   blanket amnesty. While the grain IS colour-wise the live set SPEAKS the colour
   axis, so a figure typed against a colourway that has left the ORDER is still
   dropped — the client's "the grid follows the order exactly" survives intact on
   every axis the live set expresses. Made to fail against a draft that muted an
   axis whenever ANY override disagreed with the live set. */
const withDeadColour = [
  ...colourTyped,
  { combo: "BLACK", size_id: null, country_id: null, combination: null, style_ref_no: "S1" },
];
check(
  "a colourway that left the ORDER is still dropped while the grain speaks colour",
  liveOverrides(withDeadColour, colourLive).map((o) => o.combo),
  ["WHITE", "NAVY"],
);
check(
  "...and it is the row NAMED as orphaned",
  orphanedOverrides(withDeadColour, colourLive).map((o) => o.combo),
  ["BLACK"],
);
/* THE PARTITION MUST HOLD ON THE NEW RULE TOO, and on a set where something is
   genuinely discarded — asserting it only where nothing is orphaned would pass
   against a function that had stopped reporting altogether. */
check(
  "kept + orphaned is the input on a set that DOES discard",
  liveOverrides(withDeadColour, colourLive).length +
    orphanedOverrides(withDeadColour, colourLive).length,
  withDeadColour.length,
);
/* THE TWO HALVES MUST PARTITION. An override is written or it is reported, never
   both and never neither — a gap between them is a row that vanishes with
   nothing said about it, which is the whole failure being reported on. */
check(
  "kept + orphaned is always the input, exactly",
  liveOverrides(colourTyped, orderLive).length + orphanedOverrides(colourTyped, orderLive).length,
  colourTyped.length,
);
/* AND IT READS THE SAME "LIVE" AS THE FILTER DOES. A combination row excused by
   `liveOverrides` must not be reported as orphaned by its complement, or the
   screen would warn about rows that are in fact being saved. */
check(
  "a combination row the filter excuses is not reported as orphaned",
  orphanedOverrides(withParts, liveNoParts).length,
  0,
);

/*
 * §6c  THE CALLER'S PRECONDITION: pass every slice the grid draws, or lose rows.
 *
 * These vectors do NOT bless the behaviour they describe — `liveOverrides` is
 * correct and is being fed an incomplete set. They pin the COST of the omission,
 * because it is a delete on the way out and the two plausible partial sets each
 * destroy something different. A caller reading only the first would "fix" it by
 * passing the tick and silently swap one casualty for another.
 *
 * Size is deliberately NOT excused the way the combination axis is: a size is
 * obtainable (`productionSlices` emits one per size on request), so an
 * incomplete set is a caller defect rather than an unknowable axis. Excusing it
 * would keep stale size rows alive forever.
 */
const tickedTyped = [
  /* the ticked row's OWN figure, which the client requires to survive a tick */
  { combo: "WHITE", size_id: null, country_id: null, combination: null, style_ref_no: "S1" },
  /* a figure typed against one of its sizes */
  { combo: "WHITE", size_id: "size-s", country_id: null, combination: null, style_ref_no: "S1" },
];
/* PRIMARY ONLY — a live set computed without the sizeWise predicate. */
const livePrimary = [{ combo: "WHITE", size_id: null, country_id: null, style_ref_no: "S1" }];
/* EXPANDED ONLY — the tick REPLACES the row with its children, never adds. */
const liveExpanded = [
  { combo: "WHITE", size_id: "size-s", country_id: null, style_ref_no: "S1" },
  { combo: "WHITE", size_id: "size-m", country_id: null, style_ref_no: "S1" },
];

/* THE SAFETY NET, and it is why this is no longer a deletion. A primary-only set
   speaks no size axis at all, so the axis stands down and the size figure
   SURVIVES — dormant rather than destroyed. This vector asserted `["size-s"]`
   until the generalisation and was inverted with it. What is lost is the
   CLEANUP, not the figure: a size genuinely dropped from Quantities is no longer
   tidied away, which is why the union below is still required of the caller. */
check(
  "a live set without the size children no longer DELETES the size figure",
  orphanedOverrides(tickedTyped, livePrimary).map((o) => o.size_id),
  [],
);
check(
  "...and passing the tick alone loses the PARENT's figure instead",
  orphanedOverrides(tickedTyped, liveExpanded).map((o) => o.size_id),
  [null],
);
/* THE UNION IS THE ONLY SET THAT KEEPS BOTH, and it is what the grid renders. */
check(
  "the union of primary and expanded keeps every typed figure",
  liveOverrides(tickedTyped, [...livePrimary, ...liveExpanded]).length,
  2,
);
check(
  "...and orphans nothing",
  orphanedOverrides(tickedTyped, [...livePrimary, ...liveExpanded]).length,
  0,
);

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

console.log("\n§9  missingItemFields reads the figures where they are TYPED");

// ---------------------------------------------------------------------------
// Items and Pcs LEFT THE LINE on 2026-08-21 and are typed on the slice rows.
// The check kept asking the line, so a finished line reported both as missing —
// blocking "+ Add material" AND, through mbaItemInput's superRefine, SAVE
// (client 2026-08-25, screenshot 2487).
//
// Verified by making it FAIL first: with the `slicesAnswer` clauses removed,
// the first two vectors below report "No. of Items, Per Pieces".
// ---------------------------------------------------------------------------
const ITEM = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";
const base = {
  category_id: CAT,
  item_id: ITEM,
  requirement_grain: [] as readonly string[],
  requirement_basis: null,
  no_of_items: null,
  per_pieces: null,
};
const labels = (v: Parameters<typeof missingItemFields>[0]) =>
  missingItemFields(v).map((m) => m.label);

check(
  "figures on the slice finish the line",
  labels({ ...base, slices: [{ no_of_items: 2, per_pieces: 1 }] }),
  [],
);
check(
  "...and on the line, as before",
  labels({ ...base, no_of_items: 2, per_pieces: 1 }),
  [],
);
check(
  "neither is still unfinished, and says so",
  labels(base),
  ["No. of Items", "Per Pieces"],
);
check(
  "ONE blank slice among several still blocks",
  labels({ ...base, slices: [{ no_of_items: 2, per_pieces: 1 }, { no_of_items: null, per_pieces: 1 }] }),
  ["No. of Items"],
);
check(
  "an UNTICKED blank row buys nothing, so it cannot block",
  labels({
    ...base,
    slices: [{ no_of_items: 2, per_pieces: 1 }, { chosen: false, no_of_items: null, per_pieces: null }],
  }),
  [],
);
check(
  "a blank LINE is still answered by every chosen slice",
  labels({ ...base, slices: [{ chosen: true, no_of_items: 3, per_pieces: 2 }] }),
  [],
);
check(
  "zero is not a figure — a rate of 0 buys nothing",
  labels({ ...base, slices: [{ no_of_items: 0, per_pieces: 1 }] }),
  ["No. of Items"],
);
check("a line naming no material is never unfinished", labels({ ...base, item_id: null }), []);

/* -------------------------------------------------------------------------
   §7  THE COMBINATION CROSSING — the screen and the server share one

   `sliceKey` has carried `combination` since 0463, so an override typed against
   a garment part is identified partly BY that part. The screen crossed its rows
   by the line's names and the SERVER DID NOT, so every row `requirementRows`
   built keyed as "" and no combination override matched on the way to storage.

   The screen was RIGHT, which is what made it dangerous: the operator saw the
   figure they typed while the STORED requirement carried another, and a purchase
   order is checked against the stored one.

   MADE TO FAIL FIRST: the resolution vectors below return the line's own 2 when
   the row is uncrossed, and 3 once it carries its name.
   ------------------------------------------------------------------------- */
console.log("\n§7  combination crossing");

check("no names leaves the rows alone", crossCombinations([{ k: 1 }, { k: 2 }], []).length, 2);
/* NULL, NOT "" — the value every pre-0463 row already coalesces to, so nothing
   already stored moves. */
check(
  "...and marks them null, not with a blank name",
  crossCombinations([{ k: 1 }], []).map((r) => r.combination),
  [null],
);
check("two names double the rows", crossCombinations([{ k: 1 }, { k: 2 }], ["TOP", "BOT"]).length, 4);
check(
  "...and each row carries the name it was crossed by",
  crossCombinations([{ k: 1 }], ["TOP", "BOT"]).map((r) => r.combination),
  ["TOP", "BOT"],
);

/* THE NAMES ARE READ OFF THE SLICES, trimmed and de-duplicated. A half-typed row
   carries "" and must never become a panel named nothing — that would cross
   every production row against an empty name and double the grid. */
check(
  "names are distinct, trimmed, and blanks dropped",
  combinationNames([
    { combination: "TOP" },
    { combination: " TOP " },
    { combination: "" },
    { combination: null },
    { combination: "BOT" },
  ]),
  ["TOP", "BOT"],
);

/* THE RESOLUTION, which is the whole point. */
const comboOverrides = toOverrides([
  { combo: "WHITE", combination: "TOP", no_of_items: 3, per_pieces: 1 },
]);
const uncrossedRow = { combo: "WHITE", size_id: null, country_id: null, style_ref_no: null };
check(
  "an UNCROSSED row misses the override — the defect, stated",
  consumptionFor({ no_of_items: 2, per_pieces: 1 }, comboOverrides, uncrossedRow).no_of_items,
  2,
);
check(
  "...and a crossed row finds it",
  consumptionFor(
    { no_of_items: 2, per_pieces: 1 },
    comboOverrides,
    crossCombinations([uncrossedRow], ["TOP"])[0],
  ).no_of_items,
  3,
);
/* AND IT DOES NOT LEAK ACROSS PARTS — one typed figure must not reprice every
   panel on the line. */
check(
  "a different part keeps the line's own rate",
  consumptionFor(
    { no_of_items: 2, per_pieces: 1 },
    comboOverrides,
    crossCombinations([uncrossedRow], ["BOT"])[0],
  ).no_of_items,
  2,
);

console.log(
  failed === 0
    ? "\nOK — every BOM slice vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
