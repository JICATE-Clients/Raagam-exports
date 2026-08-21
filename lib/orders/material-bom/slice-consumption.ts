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
  no_of_items: number | null;
  per_pieces: number | null;
};

/** The slice being asked about — `ProductionSlice` satisfies this. */
export type SliceKey = {
  combo: string | null;
  size_id: string | null;
};

/** The line's own figures, which every slice falls back to. */
export type LineDefaults = {
  no_of_items: number | null;
  per_pieces: number | null;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/** The key a slice and an override must agree on to be the same slice. */
export function sliceKey(s: SliceKey): string {
  return `${norm(s.combo)}:${s.size_id ?? ""}`;
}

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
): LineDefaults {
  const o = overrideFor(overrides, slice);
  return {
    no_of_items: o?.no_of_items ?? line.no_of_items,
    per_pieces: o?.per_pieces ?? line.per_pieces,
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
 */
export function liveOverrides<T extends SliceKey>(
  overrides: readonly T[] | null | undefined,
  slices: readonly SliceKey[],
): T[] {
  const live = new Set(slices.map(sliceKey));
  return (overrides ?? []).filter((o) => live.has(sliceKey(o)));
}
