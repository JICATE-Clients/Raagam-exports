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
  return `${norm(s.combo)}:${s.size_id ?? ""}:${s.country_id ?? ""}`;
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
 */
export function liveOverrides<T extends SliceKey>(
  overrides: readonly T[] | null | undefined,
  slices: readonly SliceKey[],
): T[] {
  const live = new Set(slices.map(sliceKey));
  return (overrides ?? []).filter((o) => live.has(sliceKey(o)));
}
