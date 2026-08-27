/**
 * Material BOM — THE EXPLOSION GRAIN, as a SET OF AXES.
 *
 * The client's matrix names 28 attribute permutations — "Style Ref No / Order
 * Color / Order Size", "Combination / Order Color", and so on. This module is
 * the vocabulary behind them, and the shape is the whole point:
 *
 *     the grain is a SET OF AXES; the label is DERIVED FROM the set.
 *
 * ## WHY NOT 28 STRING LITERALS, WHICH IS WHAT THE SPEC ASKED FOR
 *
 * The spec proposed a union of 28 display strings, matched by
 * `attribute.split(' / ')`. Three reasons that is the wrong storage vocabulary
 * here, each one a failure this repo has already had:
 *
 *  1. **A LABEL IS NOT A KEY.** `REQUIREMENT_BASES` is lowercase and CHECKed in
 *     the column precisely because a display name is operator-editable and
 *     stored in CAPITALS — `=== "Color-wise"` compiles, runs and quietly matches
 *     nothing. AGENTS.md records that twice, under Nominated vendors and again
 *     under the material-attribute lookup that resolved to "no basis" for every
 *     row while looking configured.
 *  2. **THE SEPARATOR IS SIGNIFICANT WHITESPACE.** `split(' / ')` returns one
 *     token for `"Style /Order Color"` and an empty token for a double space,
 *     and the spec's parser then THROWS on the unrecognised branch — inside an
 *     engine whose entire design is that it never throws and instead returns a
 *     `Refusal` carrying the sentence the screen prints.
 *  3. **THE MATRIX IS NOT 28 THINGS.** A grouping key is a set, so order within
 *     a permutation carries no information: #9 is #7, #10 is #4, #18 is #14,
 *     #24 is #19, and #21 differs from #19 only by an axis that is constant
 *     within one BOM. Enumerating them invites the five duplicates to drift
 *     apart. Deriving them makes that impossible — see `check-bom-explosion.mts`,
 *     which asserts the collapse rather than assuming it.
 *
 * So a set goes in the column and `labelFor()` renders it. There is exactly one
 * direction: **set -> label, never label -> set.**
 *
 * ## THE AXES ARE THE GRAIN AND NOTHING ELSE IS
 *
 * A slice carries fields the grain did not ask for. `productionSlices` keeps
 * `style_ref_no` on a size-wise and a country-wise row *opportunistically* —
 * only where the order has ONE style — as provenance for the label, and its own
 * comment says why it must not be read as a division: *"a row keyed to a style
 * the operator did not ask to split by would imply a division that was never
 * requested."*
 *
 * **So `groupKeyFor` reads the DECLARED axes and never "whichever fields are
 * non-null".** Inferring the grain from the payload would make a one-style order
 * group by style and a two-style order not, which is a grain that changes with
 * the data.
 */

import type { RequirementBasis } from "@/lib/orders/material-bom/requirement";

/** What the screen prints when a grain cannot be resolved. Same shape as
 *  `requirement.ts`'s, deliberately: one refusal vocabulary for one pipeline. */
export type Refusal = { refused: string };

export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && typeof (v as Refusal).refused === "string";
}

// ---------------------------------------------------------------------------
// The axes
// ---------------------------------------------------------------------------

/**
 * THE ORDER OF THIS TUPLE IS THE CANONICAL ORDER, and it does two jobs at once:
 * it is the order axes are SORTED into for storage, and the order they are READ
 * in a label. One definition, so `{size, colour}` and `{colour, size}` cannot
 * store differently or render differently.
 *
 * It reads OUTWARD-IN, the same argument `REQUIREMENT_BASES` makes: the style,
 * then a colourway of that style, then a size of that colourway, then the trim's
 * own colour within it — each a finer cut of the one before. `country` and
 * `pack` are appended because they cut by WHERE THE GOODS GO and HOW THEY ARE
 * BOXED, which are different questions, not further degrees of fineness.
 */
export const AXES = [
  "style_ref",
  "colour",
  "size",
  "trim_colour",
  "country",
  "pack",
] as const;

export type Axis = (typeof AXES)[number];

/**
 * The client's own words for each axis, for `labelFor`.
 *
 * `trim_colour` IS THE CLIENT'S "Combination", and the storage name deliberately
 * differs from the display name. "Combination" already means two things in this
 * module — `requirement_basis = 'combination'` (colour x size, 0420) and the
 * free-text `combination` column on a BOM line — and `mba-master-screen.tsx`
 * carries a comment about that collision. A third `combination` in the stored
 * vocabulary would make the word unusable. The stored name says what the axis
 * IS: the Combination sheet's panels collapse onto TRIM COLOUR before a
 * requirement row exists (`colourSplits`, 0436), so trim colour is the grain.
 */
const AXIS_LABELS: Record<Axis, string> = {
  style_ref: "Style Ref No",
  colour: "Order Color",
  size: "Order Size",
  trim_colour: "Combination",
  country: "Country",
  pack: "Pack Ref No",
};

/**
 * AXES WITH NO DATA SOURCE ON THIS SCHEMA, and the reason each is listed rather
 * than silently absent.
 *
 * `pack` — the client's matrix uses "Pack Ref No" in four permutations (#11,
 * #15, #25, #27) and **no such column exists**. `garment_order_amendment_pack_types`
 * holds a `pack_type` text; the order-side `order_pack_ratios.assort_no` is the
 * nearest identifier and hangs off the `sales_orders` scaffold, not the
 * amendment. Treating a missing axis as "everything in one bucket" is the
 * blank-supply-type failure the nominated-vendor rule refuses twice over: the
 * grouping would silently be one grain coarser than the operator asked for, and
 * the figure would look entirely reasonable.
 *
 * `Order No` is NOT here, and that is a different call — but the reason given
 * for it was WRONG, and the correction matters more than the conclusion.
 *
 * It used to read: "a BOM names one `garment_order_id`, so it is a CONSTANT
 * within any explosion". **That is false whenever `multi_order` is on** (0427):
 * the whole point of that toggle is that one order carries a DIFFERENT buyer PO
 * number on each quantity row, so `po_no` divides an explosion exactly as
 * `country` does. The premise was true when it was written and stopped being
 * true when the feature shipped.
 *
 * The conclusion stands, on a different footing: **PO No is COMMERCIAL METADATA,
 * not a production grain.** It names who is billed for a lot, not what has to be
 * cut, dyed or issued to the floor. Splitting an explosion by it would produce
 * two requirement lines for one physical dye lot, and the purchasing side would
 * then round each of them up to its own MOQ — the client's own rule (B) for the
 * same reason: it corrupts MOQ consolidation downstream.
 *
 * So it is excluded ON PURPOSE rather than for want of data, and it is not
 * offered rather than refused — #21 is #19 with a token that must not divide
 * anything. `resolveRowPoNo` in `lib/orders/po-no.ts` is where that metadata is
 * read instead, on the documents that bill the lot.
 */
const UNAVAILABLE: Partial<Record<Axis, string>> = {
  pack: "Pack Ref No is not on the order yet — no packing reference to split by",
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** The separator in the stored form. `+` because it cannot occur in an axis
 *  name and does not need escaping in a URL, a CHECK constraint or a filename. */
const SEP = "+";

/**
 * Canonicalise: de-duplicated, sorted into `AXES` order.
 *
 * THE SORT IS WHAT MAKES THE DUPLICATES IMPOSSIBLE. #4 and #10 differ only in
 * the order their tokens were typed, so canonicalising on the way in means the
 * two cannot be stored as different values and later diverge — the collapse is
 * structural rather than a rule somebody has to remember.
 */
export function canonicalAxes(axes: readonly Axis[]): Axis[] {
  const seen = new Set<Axis>(axes);
  return AXES.filter((a) => seen.has(a));
}

/**
 * The stored form — lowercase, `+`-joined, canonical.
 *
 * AN EMPTY SET IS `""`, NOT `"order"`. The whole-order grain is the ABSENCE of
 * any division, and giving it a token of its own would make it a seventh axis
 * that every reader has to special-case. `labelFor` still names it, because a
 * blank cell and "the whole order" must not look alike.
 */
export function serializeAxes(axes: readonly Axis[]): string {
  return canonicalAxes(axes).join(SEP);
}

/**
 * Read a stored grain, REFUSING anything unrecognised.
 *
 * EMPTY-AND-EXPLAIN, NEVER A FALLBACK. `basisOf` in requirement.ts makes the
 * same call for the same reason: a silent fallback to "the whole order" makes
 * the Attribute advisory, and the operator never learns it needs filling in.
 * It also never throws — the spec's parser did, and a throw in this pipeline
 * takes out the screen rather than printing a sentence in one cell.
 */
export function parseAxes(stored: string | null | undefined): Axis[] | Refusal {
  const raw = (stored ?? "").trim().toLowerCase();
  if (raw === "") return [];

  const out: Axis[] = [];
  for (const token of raw.split(SEP)) {
    const t = token.trim();
    if (t === "") continue;
    if (!(AXES as readonly string[]).includes(t)) {
      return { refused: `"${t}" is not a split this order can be exploded by` };
    }
    out.push(t as Axis);
  }
  return canonicalAxes(out);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * The client's label for a grain — the ONE direction this module goes.
 *
 * Reading it back the other way is what the spec asked for and is what makes a
 * display string load-bearing. Nothing here parses a label.
 */
export function labelFor(axes: readonly Axis[]): string {
  const canon = canonicalAxes(axes);
  // NAMED, never blank. "Whole order" is `productionSlices`' own word for this
  // row, so the two surfaces say the same thing.
  if (canon.length === 0) return "Whole order";
  return canon.map((a) => AXIS_LABELS[a]).join(" / ");
}

/**
 * Whether this grain can be resolved on this schema, and why not when it cannot.
 *
 * Called BEFORE any explosion, so an unbuildable grain refuses with a sentence
 * instead of producing a smaller row count that reads as a correct answer —
 * the partial-explosion failure `requirement.ts` opens its header with.
 */
export function axesAvailable(axes: readonly Axis[]): true | Refusal {
  for (const a of canonicalAxes(axes)) {
    const why = UNAVAILABLE[a];
    if (why) return { refused: why };
  }
  return true;
}

// ---------------------------------------------------------------------------
// The bridge from the six stored bases
// ---------------------------------------------------------------------------

/**
 * WHAT EACH EXISTING `requirement_basis` MEANS AS A SET OF AXES.
 *
 * This is the compatibility half, and it is asserted rather than asserted-by-
 * comment: `check-bom-explosion.mts` runs the real `productionSlices` for each
 * basis and proves that `groupKeyFor(axesOfBasis(b), slice)` gives exactly one
 * distinct key per slice that basis emits. A stored row therefore keeps its
 * meaning through the change, which is the only thing that makes this safe to
 * put in front of live documents.
 *
 * Two entries are worth reading twice:
 *
 *  - **`colour` is `{style_ref, colour}`, not `{colour}`.** The branch keys on
 *    (style, combo) deliberately: WHITE can exist under two styles with
 *    different targets, and collapsing them would let one style's white absorb
 *    the other's.
 *  - **`size` is `{size}` ALONE**, even though its slices carry a
 *    `style_ref_no`. That field is set only where the order has one style, as
 *    provenance; the grain is one row per size across every colourway, which is
 *    0420's whole argument — "how many Mediums?" is one number. `country` is
 *    the same shape for the same reason.
 */
const BASIS_AXES: Record<RequirementBasis, Axis[]> = {
  order: [],
  style: ["style_ref"],
  colour: ["style_ref", "colour"],
  size: ["size"],
  combination: ["style_ref", "colour", "size"],
  country: ["country"],
};

export function axesOfBasis(basis: RequirementBasis): Axis[] {
  return BASIS_AXES[basis];
}

/**
 * The legacy name for a grain, or null when it has none.
 *
 * ## WHY A GRAIN WITH NO NAME IS THE NORMAL CASE, NOT AN ERROR
 *
 * Six of the nine producible grains have one of the six legacy names; the other
 * three do not, because they were never expressible before the set model. The
 * client's #16 — `{style_ref, colour, size, country}` — is the clearest: there
 * has never been a basis meaning "the matrix, split by destination".
 *
 * `material_bom_amendment_requirements.basis` is CHECKed against exactly those
 * six names, so this is what decides whether a requirement row can carry one.
 * 0456 made that column NULLABLE for this reason rather than widening its
 * vocabulary: one column holding two vocabularies would let `'colour'` and
 * `'style_ref+colour'` mean the same thing while comparing unequal.
 *
 * DERIVED FROM `BASIS_AXES`, never a second table. A hand-written reverse map is
 * two declarations of one fact, and the day they disagree a stored row changes
 * meaning — which is the whole failure this module is built to prevent.
 */
export function basisForAxes(axes: readonly Axis[]): RequirementBasis | null {
  const want = serializeAxes(axes);
  for (const [basis, mapped] of Object.entries(BASIS_AXES) as [RequirementBasis, Axis[]][]) {
    if (serializeAxes(mapped) === want) return basis;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The grouping key
// ---------------------------------------------------------------------------

/**
 * As much of an exploded row as a grouping key needs.
 *
 * `trim_colour` arrives from the BOM LINE's Combination sheet rather than from
 * the order (`colourSplits`, 0436), which is why it sits beside the order's own
 * axes rather than inside `ProductionSlice`.
 */
export type ExplodedSlice = {
  style_ref_no?: string | null;
  combo?: string | null;
  size_id?: string | null;
  item_color_id?: string | null;
  country_id?: string | null;
};

/** NUL, so a value containing the separator cannot forge another row's key —
 *  the same choice `SLICE_SEP` makes in requirement.ts. */
const KEY_SEP = "\u0000";

/**
 * A slice's value on one axis, NORMALISED THE WAY THE ENGINE ALREADY COMPARES.
 *
 * Names are upper-cased and trimmed for the reason `styleKey` and `comboKey`
 * exist: rows saved before the CAPITALS rule are not upper-cased, and a combo
 * differing only in case is the same colourway. Ids are compared verbatim —
 * a uuid has no case question and lower-casing one would be inventing a rule.
 */
function valueOn(axis: Axis, slice: ExplodedSlice): string | null {
  switch (axis) {
    case "style_ref":
      return slice.style_ref_no == null ? null : slice.style_ref_no.trim().toUpperCase();
    case "colour":
      return slice.combo == null ? null : slice.combo.trim().toUpperCase();
    case "size":
      return slice.size_id ?? null;
    case "trim_colour":
      return slice.item_color_id ?? null;
    case "country":
      return slice.country_id ?? null;
    case "pack":
      // Unreachable through `axesAvailable`, and answered rather than thrown:
      // a grain that got here without being checked must not take the screen
      // down. It produces one bucket, which `axesAvailable` is what stops.
      return null;
  }
}

/**
 * The key this slice groups under, for a declared grain.
 *
 * ## NULL IS A VALUE, AND IT IS NOT `'any'`
 *
 * The spec's parser substituted `'any'`, `'none'`, `'bulk'` and `'default'` for
 * a missing value. Three things go wrong with that here, and the third is the
 * one that costs money:
 *
 *  - **`'any'` is a legal colour name**, so a row genuinely coloured ANY would
 *    key identically to a row with no colour at all;
 *  - a null on an axis is a REAL answer in this engine — "this grain has no such
 *    axis" — which `sliceKey`'s own header spells out for the country axis;
 *  - two different questions resolving to one stored answer is exactly how the
 *    country axis broke before it was added to the key: *"one figure silently
 *    answering for the other, on the row a purchase order is written from."*
 *
 * So a null is encoded as an empty field between separators and compared, never
 * replaced by a word.
 *
 * AN EMPTY GRAIN GIVES ONE KEY FOR EVERYTHING, which is the whole-order row and
 * is correct: no axes means no division.
 */
export function groupKeyFor(axes: readonly Axis[], slice: ExplodedSlice): string {
  return canonicalAxes(axes)
    .map((a) => `${a}:${valueOn(a, slice) ?? ""}`)
    .join(KEY_SEP);
}

/**
 * How many distinct rows a grain produces over a set of slices.
 *
 * Present so a screen can say "this attribute makes 12 rows" BEFORE the operator
 * commits to it — the 28-permutation matrix is unreadable without that, and a
 * planner choosing between `Style Ref No / Order Color` and
 * `Style Ref No / Order Color / Order Size` is choosing between 3 rows and 15.
 */
export function rowCountFor(axes: readonly Axis[], slices: readonly ExplodedSlice[]): number {
  return new Set(slices.map((s) => groupKeyFor(axes, s))).size;
}
