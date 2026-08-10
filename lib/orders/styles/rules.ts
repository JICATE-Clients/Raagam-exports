/**
 * Garment Style — the rules that run BETWEEN tabs.
 *
 * ONE DECLARATION, THREE ENFORCERS. Everything here is pure and synchronous so
 * the same function answers for all of them:
 *
 *   1. the screen — caps the Coordinates grid and counts a section's problems
 *   2. the Save button — `canSave` is derived from `styleProblems`, never
 *      hand-assembled (`customer-master-screen.tsx:1649` is what happens when
 *      it is: a list of `&& !someError` a screen can forget to extend)
 *   3. the server action — `garmentStyleInput` compiles these in via
 *      `superRefine`, so a `lib/data-io` import could not bypass them either
 *
 * No imports beyond the input type: a rule that needed a DB round trip would
 * belong in the action, not here. Everything the rules ask about is in the
 * payload — which is exactly why `unit_kind` is its own column rather than
 * something to be looked up from `unit_id` against the Stock Unit master.
 */

/**
 * How many coordinates a style may have, by unit kind.
 *
 * A "Piece" is one garment, so it has exactly one coordinate. A "Set" is two or
 * more garments sold together — a Top and a Bottom, a three-piece suit — and
 * the client caps it at six.
 */
export const COORDINATE_LIMITS = {
  piece: { min: 1, max: 1 },
  set: { min: 2, max: 6 },
} as const;

export type UnitKind = keyof typeof COORDINATE_LIMITS;

export const UNIT_KIND_OPTIONS: { value: UnitKind; label: string }[] = [
  { value: "piece", label: "Piece" },
  { value: "set", label: "Set" },
];

export function isUnitKind(v: string | null | undefined): v is UnitKind {
  return v === "piece" || v === "set";
}

/**
 * The coordinate range for a unit kind, or `null` when there is no rule to
 * apply yet.
 *
 * NULL IS NOT AN ERROR. Every style created before 2026-08-10 has no
 * `unit_kind`, and the rule must stay silent on those rather than declaring
 * historical records invalid. The form makes the field `required`, so the
 * question gets answered the next time someone edits one — but until then a
 * two-coordinate legacy style is left alone.
 */
export function coordinateLimit(
  unitKind: string | null | undefined,
): { min: number; max: number } | null {
  return isUnitKind(unitKind) ? COORDINATE_LIMITS[unitKind] : null;
}

/** A row counts toward the limit once it holds a coordinate. A blank row the
 *  grid seeded is not a coordinate the operator chose, and the save path drops
 *  it anyway (`normalizeCoordinates`). */
export type CoordinateLike = { coordinate_id: string | null };

export function filledCoordinates(rows: readonly CoordinateLike[]): number {
  return rows.filter((r) => !!r.coordinate_id).length;
}

/**
 * A problem, tagged with the rail section that can fix it.
 *
 * The section key is the load-bearing part and the reason this returns objects
 * rather than strings: only one section is mounted at a time, so a problem that
 * does not say where it lives leaves Save dead with nothing on screen to
 * explain it. Feeds `sectionValidity` in `lib/screens/validity.ts`.
 */
export type StyleProblem = { section: string; message: string };

/** What `styleProblems` needs. A subset of `GarmentStyleInput`, declared
 *  structurally so the screen can pass its live form state without building a
 *  payload first. */
export type StyleRuleInput = {
  style_name?: string | null;
  style_date?: string | null;
  unit_kind?: string | null;
  coordinates?: readonly CoordinateLike[];
};

/**
 * Everything wrong with this style, in the order the rail presents it.
 *
 * Deliberately NOT including "field X is blank" for fields the form already
 * marks `required` — those are found by `collectProblems` from the field
 * declarations, and stating them twice would double-count the rail badge. This
 * covers only what a single field cannot know on its own: the relationship
 * between Unit Type on General and the row count on Coordinates.
 */
export function styleProblems(input: StyleRuleInput): StyleProblem[] {
  const problems: StyleProblem[] = [];

  const limit = coordinateLimit(input.unit_kind);
  if (limit) {
    const n = filledCoordinates(input.coordinates ?? []);
    if (n < limit.min) {
      problems.push({
        section: "coordinates",
        message:
          limit.min === limit.max
            ? `A Piece style needs exactly ${limit.min} coordinate.`
            : `A Set style needs at least ${limit.min} coordinates — there ${n === 1 ? "is" : "are"} ${n}.`,
      });
    } else if (n > limit.max) {
      problems.push({
        section: "coordinates",
        message: `A ${input.unit_kind === "piece" ? "Piece" : "Set"} style allows at most ${limit.max} coordinate${limit.max === 1 ? "" : "s"} — there are ${n}.`,
      });
    }
  }

  return problems;
}
