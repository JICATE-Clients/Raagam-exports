/**
 * WHAT ONE SLICE OF A MATERIAL BOM LINE CONSUMES (0442).
 *
 * A line says how much of a trim the order needs; its Attribute says what it is
 * bought PER. On a Size-wise line the same button is used on every size, but the
 * same THREAD is not — a XXL seam is longer than an XS one — so the operator can
 * type a figure against any individual slice.
 *
 * ## NULL IS "INHERIT", NEVER "ZERO"
 *
 * The overrides are a sparse store: only the cells somebody typed. Everything
 * else falls back to the line's own `no_of_items` / `per_pieces`, which stay
 * typeable and act as the default (client 2026-08-21, choosing this over hiding
 * them). So a missing override, an override with one figure, and an override
 * with both all have to behave — and they compose per FIELD, not per row: a
 * slice that overrides only `no_of_items` keeps the line's `per_pieces`.
 *
 * That is the whole reason this is a function rather than `?? line`: the
 * fallback is field-by-field, and doing it inline at the call site would put the
 * rule in a loop body where the next reader will not find it.
 *
 * ## THE KEY IS THE SLICE, AND IT MUST MATCH `productionSlices`
 *
 * A slice is identified by (combo, size_id) — the pair `price_details` uses. The
 * combo is a NAME and is compared upper-cased and trimmed, for the reason
 * `styleKey` exists across this module: rows saved before the CAPITALS rule are
 * not upper-cased, and a combo that differs only in case is the same colourway.
 * A null on either side is a real value meaning "this basis has no such axis",
 * so it is normalised to "" and compared, never skipped.
 */

/** One stored override, as much of it as the resolution needs. */
export type SliceOverride = {
  combo: string | null;
  size_id: string | null;
  /** The destination, part of the key since 0449 — see `SliceKey`. */
  country_id?: string | null;
  /** The typed garment part, part of the key since 0463 — see `SliceKey`. */
  combination?: string | null;
  /** Which style, part of the key since 0464 — see `SliceKey`. */
  style_ref_no?: string | null;
  no_of_items: number | null;
  per_pieces: number | null;
  /** The wastage buffer for this row (0450). NULL inherits the line's. */
  excess_pct?: number | null;
};

/** The slice being asked about — `ProductionSlice` satisfies this. */
export type SliceKey = {
  combo: string | null;
  size_id: string | null;
  /**
   * THE DESTINATION, AND IT IS PART OF THE KEY (0449).
   *
   * A country-wise line whose USA row is size-wise produces a slice with NO
   * combo and size M — byte-identical to CH's M row. Two destinations would then
   * resolve to each other's override: one figure silently answering for the
   * other, on the row a purchase order is written from.
   *
   * The requirement side has keyed on `country_id` since 0444; leaving it out
   * here is the two stores disagreeing about what one row is.
   */
  country_id?: string | null;
  /**
   * THE TYPED GARMENT PART, AND IT IS PART OF THE KEY (0463).
   *
   * Exactly the 0449 argument one axis along, and sharper. A combination row is
   * created by typing a NAME in the Combination popup and carries no combo, no
   * size and no country of its own — so TOP and BOTTOM both key as `::` and the
   * first one found would answer for both. `overrideFor` is a `.find()`, so the
   * wrong figure would be returned silently, on the number a purchase order is
   * written from.
   *
   * NOT `combo`, which is the colourway by name and is joined on by the composer
   * — see the header of `bom-combination-sheet.tsx` for why conflating the two
   * is the failure mode rather than a tidy-up.
   */
  combination?: string | null;
  /**
   * WHICH STYLE, AND IT IS PART OF THE KEY (0464).
   *
   * The third instance of one shape, and it was a LIVE defect rather than a
   * refinement. A style-basis row carries `style_ref_no` and nothing else — combo,
   * size and country are all NULL (`productionSlices`, the `basis === "style"`
   * branch) — so every style on the line keyed as ":::" and one typed figure
   * answered for all of them:
   *
   *     key(style A) = ":::"   key(style B) = ":::"   B resolves to A's 5
   *
   * `uq_mba_req_slice` has carried `style_ref_no` since the style basis existed,
   * so this is the override store catching up with the requirement store — the
   * same sentence 0449 wrote about `country_id`, and 0463 about `combination`.
   * Three in one family is why `OVERRIDE_FIELDS` is asserted as a SET: only a
   * whole-set comparison catches a MISSING key.
   */
  style_ref_no?: string | null;
};

/** The line's own figures, which every slice falls back to. */
export type LineDefaults = {
  no_of_items: number | null;
  per_pieces: number | null;
  /** The wastage buffer. Per attribute value since 0450 — see `consumptionFor`. */
  excess_pct?: number | null;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/**
 * The key a slice and an override must agree on to be the same slice.
 *
 * THREE AXES, AND THE THIRD ARRIVED LATE (0449). A null on any of them is a real
 * value — "this basis has no such axis" — so each is normalised and compared,
 * never skipped. Skipping a null would make an order-wise override answer a
 * colour-wise row, which is the same class of bug the country axis introduced:
 * two different questions resolving to one stored answer.
 */
export function sliceKey(s: SliceKey): string {
  return `${norm(s.combo)}:${s.size_id ?? ""}:${s.country_id ?? ""}:${norm(s.combination)}:${norm(s.style_ref_no)}`;
}

/**
 * The five axes `sliceKey` is built from, as data — so `liveOverrides` can ask
 * which of them a live set actually SPEAKS (see its header).
 *
 * IT MUST STAY IN STEP WITH `sliceKey` BY HAND, so `check-bom-slices.mts`
 * asserts the set rather than trusting this comment. An axis added to the key
 * and not to this list would be silently un-muteable — the same whole-set
 * argument `OVERRIDE_FIELDS` records one field along, and the same family of
 * defect 0449, 0463 and 0464 each arrived as.
 */
export const KEY_AXES = ["combo", "size_id", "country_id", "combination", "style_ref_no"] as const;

export type KeyAxis = (typeof KEY_AXES)[number];

/**
 * One axis of a slice, read EXACTLY as `sliceKey` reads it — the id axes raw,
 * the name axes normalised. "" means the axis carries nothing.
 *
 * Reading it any other way is how two halves of one rule drift apart: a `combo`
 * of "  white " is a value here only because `sliceKey` trims and upper-cases it
 * too, and an axis judged "unexpressed" while the key still distinguishes it
 * would mute a comparison that has to happen.
 */
function axisValue(s: SliceKey, a: KeyAxis): string {
  return a === "size_id" || a === "country_id" ? (s[a] ?? "") : norm(s[a]);
}

/**
 * A stored slice row, narrowed to the override the resolver reads.
 *
 * ## THIS EXISTS BECAUSE THE INLINE VERSION WAS WRONG TWICE
 *
 * `writeChildren` built this shape with an object literal, and the literal named
 * `combo`, `size_id` and the two figures — dropping `country_id` and
 * `excess_pct`. Neither omission is visible to `tsc`: the result still satisfies
 * `SliceOverride`, because every field this drops is optional so that a row
 * saved before 0449/0450 stays readable.
 *
 * So the consequences were silent and total. `sliceKey` reads all three axes, so
 * an override keyed to USA-M matched NO slice on a country-wise line and the
 * LINE's figure was stored instead — beside a screen showing the operator's own
 * number, because the screen passed the full rows to the same `consumptionFor`.
 * The per-row Wastage % of 0450 was inert on the server for the same reason.
 *
 * A literal cannot be tested, which is why this is a function: the vectors in
 * `check-bom-slices.mts` assert the KEY SET it returns, so a field dropped here
 * fails a check rather than a purchase order.
 *
 * NORMALISING IS THE WHOLE JOB. `mbaItemSliceInput` leaves fields optional, so
 * they arrive as `string | null | undefined` where `SliceKey` wants
 * `string | null`; `undefined` would key as "" and quietly match the wrong row.
 * Done once per line rather than per slice, and here rather than by loosening
 * the shared type — the screen always supplies these, and a type that admits
 * `undefined` would stop saying so.
 */
export function toOverrides(
  slices:
    | readonly {
        combo?: string | null;
        size_id?: string | null;
        country_id?: string | null;
        combination?: string | null;
        style_ref_no?: string | null;
        no_of_items?: number | null;
        per_pieces?: number | null;
        excess_pct?: number | null;
      }[]
    | null
    | undefined,
): SliceOverride[] {
  return (slices ?? []).map((sl) => ({
    combo: sl.combo ?? null,
    size_id: sl.size_id ?? null,
    country_id: sl.country_id ?? null,
    combination: sl.combination ?? null,
    style_ref_no: sl.style_ref_no ?? null,
    no_of_items: sl.no_of_items ?? null,
    per_pieces: sl.per_pieces ?? null,
    excess_pct: sl.excess_pct ?? null,
  }));
}

/**
 * Every field an override carries, so a vector can assert the set rather than
 * spot-check members. Exported for `check-bom-slices.mts`: the defect this
 * module now guards against was a MISSING key, and only a whole-set comparison
 * catches one of those.
 */
export const OVERRIDE_FIELDS = [
  "combo",
  "size_id",
  "country_id",
  "combination",
  "style_ref_no",
  "no_of_items",
  "per_pieces",
  "excess_pct",
] as const;

/**
 * The override stored against one slice, or null.
 *
 * FIRST MATCH WINS, and there can only be one: `uq_mba_slice_line_combo_size`
 * enforces it in the database and `mbaItemInput`'s `superRefine` refuses it in
 * the form, so a second is unreachable rather than resolved by luck.
 */
export function overrideFor(
  overrides: readonly SliceOverride[] | null | undefined,
  slice: SliceKey,
): SliceOverride | null {
  const want = sliceKey(slice);
  return (overrides ?? []).find((o) => sliceKey(o) === want) ?? null;
}

/**
 * What this slice consumes — the override where one is typed, the line elsewhere.
 *
 * PER FIELD, NOT PER ROW. An operator who types only a `no_of_items` against XXL
 * means "more buttons, same per-piece", not "more buttons and no per-piece" —
 * and `per_pieces` reaching null would refuse the whole slice rather than
 * inherit, which is the failure this composition exists to avoid.
 */
export function consumptionFor(
  line: LineDefaults,
  overrides: readonly SliceOverride[] | null | undefined,
  slice: SliceKey,
): Required<LineDefaults> {
  const o = overrideFor(overrides, slice);
  return {
    no_of_items: o?.no_of_items ?? line.no_of_items,
    per_pieces: o?.per_pieces ?? line.per_pieces,
    /* THE BUFFER COMPOSES THE SAME WAY (0450). It joined the other two when the
       client moved all three off the line — "no of item and no of pcs, excess %
       also in common field, we need it only for attribute based". Per FIELD like
       its neighbours: a row that types a buffer and no ratio still inherits the
       ratio. */
    excess_pct: o?.excess_pct ?? line.excess_pct ?? null,
  };
}

/**
 * Overrides that still name a slice the order carries.
 *
 * The client's rule is that the grid FOLLOWS THE ORDER EXACTLY (2026-08-21): a
 * size dropped from Quantities takes its override with it rather than lingering
 * as an orphan row to be reconciled. So this is applied on the way OUT, at save,
 * and the stale row is simply not written.
 *
 * DELIBERATELY NOT APPLIED ON THE WAY IN. Reading is where an order is being
 * looked at, not changed — dropping on load would destroy a figure because
 * somebody opened a screen, and a size removed by mistake and put back would
 * lose its consumption in between.
 *
 * ## IT ADJUDICATES ONLY ON THE AXES THE LIVE SET ACTUALLY EXPRESSES (2026-08-25)
 *
 * A live set does not always speak every axis of `sliceKey`, and an axis it
 * cannot speak must not be allowed to vote a row down. So each override is
 * PROJECTED onto the axes the live set does express and judged there; the axes
 * it does express are still compared in full.
 *
 * The rule arrived one axis at a time and was generalised on the second, which
 * is worth knowing because both instances were live data loss:
 *
 *  - **`combination` is not the ORDER's to speak.** A garment part is typed on
 *    the LINE, in the Combination popup, so a live set built from
 *    `productionSlices` names no combination at all — and every stored
 *    combination row then matched nothing and was DROPPED. Not ignored: this
 *    filter runs on the way out, so the rows were never written. Measured on a
 *    two-part, two-colour line, 5 typed rows in and 1 kept.
 *  - **A GRAIN COLLAPSE MUTES THE AXIS IT BYPASSES.** Type WHITE=7 and NAVY=4
 *    under Colour-wise, then switch the line's Attribute to Whole order: the
 *    live set collapses to a single keyless slice, every colour-keyed figure
 *    matched nothing, and at save 0 of 2 were written. The operator changed a
 *    dropdown and lost their typing, with the line's own ratio silently left in
 *    its place.
 *
 * **CLIENT RULING, 2026-08-25: KEEP THEM.** Three options were put — keep,
 * prompt before discarding, or refuse the save — and keep was chosen. The
 * reasoning accepted with it: a grain change is the operator's own toggle on the
 * same order rather than a change to the order; the figures become live again
 * the moment the grain returns; and this module's own principle is that keeping
 * them is the recoverable direction. A bypassed figure is still ADVISORY on
 * screen — `mba-master-screen.tsx` warns that figures outside the current
 * Attribute are not counted — so nothing is kept silently.
 *
 * The caller had already written the same sentence for a different case:
 * *"the live set is UNKNOWN, not empty — filtering against it would delete every
 * override the operator has entered because a DIFFERENT tab is incomplete.
 * Keeping them is the recoverable direction."* Unknown along one axis is unknown
 * in exactly that way, so the axis stands down rather than voting to delete.
 *
 * WHAT IT IS NOT: a hole in the client's rule that the grid follows the order
 * exactly. Every axis the live set DOES speak is still adjudicated in full, so a
 * figure typed against a colourway that has left the ORDER is still dropped
 * while the grain is colour-wise — that case is pinned by its own vector, and it
 * is the one that would have made this generalisation wrong. And it
 * SELF-DISABLES: the moment a caller crosses its slices by combination, or ticks
 * a row so the set carries sizes, that axis is expressed again and the full
 * five-way comparison applies.
 *
 * ## THE CALLER STILL MUST PASS EVERY SLICE THE GRID DRAWS
 *
 * The projection above is a safety net, not a licence. A caller that hands over
 * a partial set no longer DELETES what it left out — the missing axis is muted
 * and those rows survive dormant — but the cleanup the client asked for stops
 * happening on that axis, and a genuinely stale row then lives forever.
 *
 * The precondition was violated at the save path and it cost real typing. It
 * asked `productionSlices(basis, order)` with no `sizeWise` predicate, so a
 * ticked row's size children were never in the live set and every size-level
 * override was dropped: 1 typed in, 0 kept.
 *
 * AND THE OBVIOUS REPAIR IS THE WRONG ONE. Passing the tick alone does not widen
 * the set, it MOVES it — `productionSlices` REPLACES a ticked row with its
 * children rather than emitting both — so the parent's own figures are dropped
 * instead, and those are the ones the client requires to survive a tick ("THE
 * ROW KEEPS ITS OWN FIGURES EVEN WHEN TICKED", screenshot 2465). Measured
 * against the real function: 2 of 3 kept either way, one casualty traded for the
 * other. **The live set has to be the UNION of the primary and expanded sets**,
 * which is what the grid already renders and what `liveSlicesFor` in
 * `material-bom-amendment/actions.ts` now builds.
 */
/**
 * THE OVERRIDES `liveOverrides` IS ABOUT TO DROP — the same partition, from the
 * other side, so a screen can SAY what is being discarded (2026-08-25).
 *
 * ## THE BYPASS THIS EXISTS FOR IS NOT ABOUT THE ORDER CHANGING
 *
 * `liveOverrides` drops a stale row on the client's own instruction — the grid
 * follows the order exactly, so a size removed from Quantities takes its
 * override with it. That is a change to the ORDER, and the operator made it.
 *
 * The case nobody decided is a change to the LINE. Switch a line's Attribute
 * from Colour-wise to Whole order and the live set collapses from
 * `WHITE::::S1` / `NAVY::::S1` to a single `::::` — so every colour-keyed
 * figure the operator typed matches nothing, `consumptionFor` quietly inherits
 * the line's own ratio in its place, and at save these rows are not written.
 * Measured against these functions: 2 typed, 2 resolving, 0 kept. The operator
 * changed a dropdown and lost their typing, with a plausible number left in its
 * place — the shape this module's header calls the failure that gets believed
 * rather than reported.
 *
 * ## WHY IT IS A SEPARATE FUNCTION AND NOT A FLAG ON THE FILTER
 *
 * The answer is a LIST, because the only useful thing to say names the rows —
 * "3 figures typed against WHITE, NAVY and BLACK will be discarded" is a warning
 * an operator can act on, and a boolean is one they can only ignore. It also
 * keeps `liveOverrides` returning exactly what gets written: a filter that
 * returned two arrays would put the caller one destructuring mistake away from
 * saving the rows it meant to drop.
 *
 * ADVISORY, NEVER A HOLD. This reports; it decides nothing and refuses nothing.
 * A grain change is legitimate — that is the whole point of the Attribute — so
 * a screen that blocked it would cage the operator on a correct action. The
 * warning belongs beside the dropdown, and building it is ScreenOwner's.
 */
export function orphanedOverrides<T extends SliceKey>(
  overrides: readonly T[] | null | undefined,
  slices: readonly SliceKey[],
): T[] {
  const kept = new Set(liveOverrides(overrides, slices));
  /* THE COMPLEMENT OF THE FILTER, never a second copy of its test. The
     combination axis stands down inside `liveOverrides` (see its header), and a
     re-implemented predicate here would be a second definition of "live" — the
     drift this file already records for `sliceKey` and `toOverrides`. Identity
     is safe: both walk the same array and return the same objects. */
  return (overrides ?? []).filter((o) => !kept.has(o));
}

export function liveOverrides<T extends SliceKey>(
  overrides: readonly T[] | null | undefined,
  slices: readonly SliceKey[],
): T[] {
  const live = new Set(slices.map(sliceKey));
  /* Asked of the SLICES, never of the overrides: the question is what the live
     set is able to adjudicate, and the stored rows are the thing being judged.
     Asking it of the overrides would let a stored row vote itself alive. */
  /*
   * ## THE UNTICKED LINE KEEPS ITS SIZE FIGURES, AND THAT IS A CLIENT DECISION
   *
   * The size axis is expressed only while some row on the line is ticked
   * Size-wise. With no tick anywhere, `productionSlices` returns the primary
   * rows unchanged, BOTH HALVES OF THE UNION ARE IDENTICAL, and size falls into
   * `mute` below — so figures typed under a tick SURVIVE the untick instead of
   * being filtered away.
   *
   * That is the one case where a genuinely stale row is kept rather than tidied,
   * and it is deliberate. It was argued the other way first, on solid grounds: a
   * size is OBTAINABLE from an order (unlike a garment part, which is why
   * `combination` is muted unconditionally), so an unexpressed size axis is
   * arguably a caller defect rather than an unknowable, and excusing it lets
   * stale size rows live indefinitely. The client was shown that trade and chose
   * to keep the figures (2026-08-25):
   *
   *     "If an operator painstakingly types size-wise figures, accidentally
   *      unticks the size, and watches their data instantly vaporize, it causes
   *      severe frustration... re-ticking the size restores their exact state."
   *
   * THE FIGURES ARE DORMANT, NOT ACTIVE — and that half is what makes keeping
   * them safe. On an unticked line no size rows are drawn at all, so the stored
   * figures are invisible to the operator and reach NOTHING: not consumption,
   * not the MOQ rollup, not budget costing. They are inert until a tick brings
   * their rows back, at which point the axis is expressed again, this excuse
   * stands down, and they are adjudicated in full like any other row.
   *
   * So a reader finding a size override on a line with no tick is NOT looking at
   * an uncleaned state leak. Deleting it "for tidiness" is the exact data loss
   * the client refused, and restoring that needs a new decision, not a cleanup.
   */
  const mute = KEY_AXES.filter((a) => !slices.some((s) => axisValue(s, a) !== ""));
  if (mute.length === 0) return (overrides ?? []).filter((o) => live.has(sliceKey(o)));
  return (overrides ?? []).filter((o) => {
    /* PROJECT THE ROW ONTO THE AXES THE LIVE SET SPEAKS, then ask the ordinary
       question. Nulling a muted axis is not "ignore this row" — every remaining
       axis is still compared in full, which is what keeps a dead colourway dead
       while a collapsed grain is excused. */
    const projected: SliceKey = { ...o };
    for (const a of mute) projected[a] = null;
    return live.has(sliceKey(projected));
  });
}

/**
 * THE DISTINCT COMBINATION NAMES A LINE CARRIES.
 *
 * A "combination" is a garment part the line splits into — TOP, BOTTOM, SLEEVE.
 * The names are not a stored list of their own: they are the distinct
 * `combination` values on the line's slice rows (0463), which is why this reads
 * them rather than taking a list.
 *
 * Trimmed and de-duplicated, blanks dropped: a half-typed row carries "" and
 * must not become a panel named nothing, which would cross every production row
 * against an empty name and double the grid.
 */
export function combinationNames(
  slices: readonly { combination?: string | null }[] | null | undefined,
): string[] {
  return Array.from(
    new Set((slices ?? []).map((s) => norm(s.combination)).filter((n) => n !== "")),
  );
}

/**
 * CROSS PRODUCTION ROWS BY THE LINE'S COMBINATION NAMES.
 *
 * ## WHY THIS IS SHARED AND NOT A SCREEN DETAIL
 *
 * `sliceKey` has carried `combination` since 0463, so a typed override is
 * identified partly by which garment part it belongs to. The SCREEN crossed its
 * production rows by the line's names, so its rows carried a `combination` and
 * resolved those overrides. The SERVER did not — `requirementRows` built slices
 * straight from `productionSlices`, every row keyed with `combination: ""`, and
 * so **no combination override matched anything on the way to storage**.
 *
 * The result was the worst shape a defect can take here: the screen showed the
 * figure the operator typed, and the STORED requirement — the one a purchase
 * order is checked against — carried a different one. Measured on a two-part,
 * two-colour line at ratio 2/1 with TOP=3 and BOTTOM=1 typed on both colourways:
 * the screen and the honest answer are 2,000, the server stored 1,000. Nothing
 * on screen said so, because the screen was right.
 *
 * So the crossing is one function with two callers, which is the only shape that
 * makes the two agree by construction rather than by both being maintained.
 *
 * ## A LINE WITH NO NAMES IS `null`, NOT `""`
 *
 * `null` means "this line has no combinations" and reaches `sliceKey`'s coalesce
 * as the same value every pre-0463 row already has — so nothing stored before
 * this existed moves, and the rows are returned unmultiplied rather than crossed
 * against a single empty name.
 *
 * ## THE UI KEY IS NOT THIS FUNCTION'S BUSINESS
 *
 * The screen also prefixes its own row key with the name, because a size child
 * is found again by `startsWith` and the parent's key must stay a PREFIX of its
 * children's. That is a rendering concern and stays at the call site; what is
 * shared is the axis that identifies a STORED row.
 */
export function crossCombinations<T extends object>(
  rows: readonly T[],
  names: readonly string[],
): (T & { combination: string | null })[] {
  if (names.length === 0) {
    return rows.map((sl) => ({ ...sl, combination: null as string | null }));
  }
  return names.flatMap((name) =>
    rows.map((sl) => ({ ...sl, combination: name as string | null })),
  );
}
