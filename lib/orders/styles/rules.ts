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
 * "piece" → "Piece". Null for anything else, INCLUDING null itself.
 *
 * Exists so the Garment Order can print the unit it seeds from a style without
 * a second copy of the words, and returns null rather than "" or "—" because
 * what to show for "not answered yet" is the caller's decision: a grid cell
 * wants a dash, a summary line wants the row omitted.
 */
export function unitKindLabel(v: string | null | undefined): string | null {
  if (!isUnitKind(v)) return null;
  return UNIT_KIND_OPTIONS.find((o) => o.value === v)?.label ?? null;
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

/**
 * HOW MANY COORDINATES A LINE MAY GROW TO — the same rule with the unanswered
 * case decided, for a caller that has to produce a number rather than a maybe.
 *
 * Client 2026-08-27, on the Garment Order: "if Order Unit is PCS, just the
 * single coordinate — hide the add coordinate option; if they choose SET they
 * can add multiple". So the Order Unit gates the grid, which is `coordinateLimit`
 * read forwards.
 *
 * THE CEILING IS THE FALLBACK, AND THAT IS NOT A DETAIL. An unanswered unit is
 * still DERIVED from the coordinate count (`unitKindFromCoordinates` below), so
 * a caller that capped by the derived kind would close a loop the order screen
 * already hit once (2026-08-25): one coordinate derives "piece", piece allows
 * exactly one, and no line could ever hold a second. Falling back to the widest
 * range keeps the question open until somebody answers it.
 *
 * That loop is why this is a FUNCTION rather than the two-line expression it
 * replaces. It was written out at both call sites on the order screen — the
 * hidden "+ Add" and the keystroke that refuses — and the vectors in
 * `check-style-rules.mts` can reach neither. One place, one answer, and the
 * button and the key cannot disagree about the limit.
 *
 * A LINE ALREADY OVER ITS CAP IS NOT THIS FUNCTION'S PROBLEM. Switching a
 * three-coordinate style to PCS returns {1,1}; the caller stops offering more
 * and leaves the three alone. Deleting entered rows because a dropdown changed
 * is the data loss "Disabled rows" refuses for the same reason.
 */
export function coordinateCap(unitKind: string | null | undefined): {
  min: number;
  max: number;
} {
  return (
    coordinateLimit(unitKind) ?? {
      min: COORDINATE_LIMITS.piece.min,
      max: COORDINATE_LIMITS.set.max,
    }
  );
}

/**
 * THE SAME RULE READ BACKWARDS — how many coordinates a line declares tells you
 * what kind of unit it is. One garment is a Piece; two or more sold together are
 * a Set.
 *
 * This exists because the Garment Order's Style became MANUAL ENTRY on
 * 2026-08-25 (client: "allow it manual entry now, unwire that style mapping").
 * The line's Order Unit used to be read through `style_id` off the master's
 * `unit_kind` — "resolving it through `style_id` on every read means the two can
 * never drift" — and with no `style_id` there is nothing to resolve. The choice
 * was between a blank column, a new stored column with a new question for the
 * operator, and this: the order already declares its coordinates, and
 * `COORDINATE_LIMITS` directly above says what a count of them MEANS.
 *
 * SO IT IS NOT AN INFERENCE, it is the existing rule with its two sides
 * swapped. The mapping is exact in both directions — piece is 1..1, set is 2..6,
 * and no count satisfies both — which is what makes it safe to run backwards. If
 * `COORDINATE_LIMITS` ever gains a third kind or overlapping ranges, this stops
 * being derivable and must go back to being stored; `scripts/check-style-rules.mts`
 * asserts the ranges stay disjoint so that day cannot pass unnoticed.
 *
 * NULL FOR ZERO, and never a default. A line whose coordinates are not entered
 * yet has not said what it is, and answering "Piece" for it would print a
 * unit the operator never chose onto Price Details, which STORES that word.
 * Above the ceiling it stays "set" rather than becoming null: six is the
 * client's cap on how many a set holds, not a claim that a seventh means
 * something else.
 */
export function unitKindFromCoordinates(count: number): UnitKind | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count <= COORDINATE_LIMITS.piece.max ? "piece" : "set";
}

/** A row counts toward the limit once it holds a coordinate. A blank row the
 *  grid seeded is not a coordinate the operator chose, and the save path drops
 *  it anyway (`normalizeCoordinates`). */
export type CoordinateLike = { coordinate_id: string | null };

export function filledCoordinates(rows: readonly CoordinateLike[]): number {
  return rows.filter((r) => !!r.coordinate_id).length;
}

/**
 * The component TYPE a fabric CATEGORY implies — the "Type" cell on a
 * Components row, filled from the Structure cell beside it.
 *
 * "STRUCTURE" ON SCREEN IS A FABRIC CATEGORY (0405) — SINGLE JERSEY, FLEECE,
 * 1X1 LYCRA RIB, COLLAR. It used to be the `fabric_structure` lookup itself,
 * which held only the three machine classes and so made Type a restatement of
 * the column beside it.
 *
 * IT IS A FETCH, NOT A CORRELATION, and that is what makes it safe to automate.
 * `categories.fabric_structure_id` is declared on the Category master: SINGLE
 * JERSEY -> Circular Knit, COLLAR -> Flat Knit, CHAMBRAY -> Woven. This resolves
 * that one hop and returns the structure's NAME, which is what the Type cell
 * shows. Nothing here decides anything the master did not already say.
 *
 * THE NAME IS RETURNED, NOT A CODE, because Type is a free-text column
 * (`comp_type`) displaying a human label, and the caller renders the same
 * `fabric_structure` rows as its options — so both sides read one list and a
 * value can never fail to match an option. Contrast the SUPERSEDED version,
 * which matched on `code` and mapped to a hardcoded ["Circular","Flat"] tuple:
 * that tuple could not express Woven at all, so CHAMBRAY and ROPE — real FABRIC
 * categories — had no Type to fill.
 *
 * **NULL MEANS "LEAVE THE CELL ALONE".** A category with no
 * `fabric_structure_id`, or one this app cannot resolve, answers "I don't know"
 * — and the caller must treat that as a no-op rather than a value to write.
 * Overwriting a Type the operator chose with a blank, because the category they
 * picked has not been filled in on its master, is auto-populate turning into
 * data loss.
 *
 * Takes the option lists rather than importing a service: this file is pure by
 * declaration (see the header), and the screen already holds both for its
 * pickers.
 */
export function componentTypeForCategory(
  categoryId: string | null | undefined,
  categories: readonly { id: string; fabric_structure_id?: string | null }[],
  structures: readonly { id: string; name: string }[],
): string | null {
  if (!categoryId) return null;
  const structureId = categories.find((c) => c.id === categoryId)?.fabric_structure_id;
  if (!structureId) return null;
  return structures.find((x) => x.id === structureId)?.name ?? null;
}

/** A component names the coordinate it belongs to — Front Body under TOP. The
 *  same shape as `CoordinateLike`, named separately because the two mean
 *  different things and a future field on either must not silently widen both. */
export type ComponentLike = { coordinate_id: string | null };

/**
 * The coordinates this style actually declared.
 *
 * EXPORTED BECAUSE THE SCREEN MUST FILTER BY THE SAME SET THE RULE JUDGES BY.
 * The Components tab's Coordinate picker offers exactly this, and
 * `orphanComponents` below flags exactly what falls outside it. Two
 * implementations of "which coordinates does this style have" would drift, and
 * the drift is invisible: the picker would offer a value the rule then rejects,
 * or reject one the picker offered.
 */
export function styleCoordinateIds(rows: readonly CoordinateLike[]): Set<string> {
  return new Set(rows.map((r) => r.coordinate_id).filter((id): id is string => !!id));
}

/**
 * Components filed under a coordinate the style does not have.
 *
 * A component with NO coordinate is not an orphan — it is unanswered, and the
 * grid cell says so on its own. Only a component pointing at something absent
 * from the Coordinates tab counts.
 *
 * UNLIKE `coordinateLimit`, THIS FIRES WHATEVER `unit_kind` SAYS, including on
 * a legacy style that has none. That is not an inconsistency with the "null is
 * not an error" note above: the count rule would fail perfectly valid old data
 * (a two-coordinate style that was never asked Piece-or-Set), whereas this one
 * can only fire on data that is genuinely self-contradictory — a part of a
 * garment attached to a section of the garment that is not there. Nothing is
 * retroactively invalidated by holding that to be wrong.
 */
export function orphanComponents(
  components: readonly ComponentLike[],
  coordinates: readonly CoordinateLike[],
): number {
  const have = styleCoordinateIds(coordinates);
  return components.filter((c) => !!c.coordinate_id && !have.has(c.coordinate_id)).length;
}

/**
 * Has the operator STARTED this component row?
 *
 * ONE PREDICATE, TWO READERS, and they must not drift. The save path drops a
 * component row that holds nothing (`normalizeComponents`), and the screen marks
 * a row's mandatory cells `required` only once it is started. Those are the same
 * question asked from opposite ends: require a field on a row that will be
 * dropped and the operator is caged on a row they never meant to add; drop a row
 * whose fields were required and a half-filled component vanishes silently.
 *
 * The trailing blank row is the case this exists for. `ChildGrid` seeds one, and
 * `material-attribute-master-screen.tsx` learned the same lesson with its star
 * row: "requiring it would cage the operator on a row they never meant to add".
 */
export type ComponentRowLike = {
  coordinate_id?: string | null;
  component_id?: string | null;
  fabric_category_id?: string | null;
  comp_type?: string | null;
  item_id?: string | null;
};

export function componentRowStarted(r: ComponentRowLike): boolean {
  return !!(
    r.coordinate_id ||
    r.component_id ||
    r.fabric_category_id ||
    (r.comp_type && r.comp_type.trim()) ||
    r.item_id
  );
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
  /**
   * `number | string` because the two callers hold it differently and neither
   * should have to convert: the screen carries `form.style_year` as the raw
   * string its input owns, and `garmentStyleInput` has already coerced it to an
   * integer by the time `superRefine` runs. `yearProblem` below compares the
   * TEXT of whatever arrives, which is the only reading that is the same
   * question for both — "how many digits did someone commit to".
   */
  style_year?: number | string | null;
  coordinates?: readonly CoordinateLike[];
  components?: readonly ComponentLike[];
};

/**
 * Everything wrong with this style, in the order the rail presents it.
 *
 * Deliberately NOT including "field X is blank" for fields the form already
 * marks `required` — those are found by `collectProblems` from the field
 * declarations, and stating them twice would double-count the rail badge. This
 * covers only what a single field cannot know on its own: the relationship
 * between Unit on General and the row count on Coordinates.
 */
export function styleProblems(input: StyleRuleInput): StyleProblem[] {
  const problems: StyleProblem[] = [];

  /**
   * A YEAR IS FOUR DIGITS (client 2026-08-21) — the guard half of the rule the
   * Year field states with `format="year"`.
   *
   * BLANK IS NOT A PROBLEM. Year is optional and 2 of the 7 styles in the live
   * database have none; requiring it here would make those rows unsaveable on
   * their next edit, which is the "a `required` nothing can answer is not a
   * stricter rule, it is a stopped screen" trap this file's neighbours already
   * record. Only a value that IS there and is not four digits fires.
   *
   * Tested as text rather than as `>= 1000 && <= 9999` so the rule reads the
   * same way the input does, and so a coerced `2026.5` cannot slip through a
   * numeric comparison that would round it into range.
   *
   * The shape is `YEAR_RE`'s, restated rather than imported: this file declares
   * itself pure with "no imports beyond the input type" (see the header), which
   * is what lets `scripts/check-style-rules.mts` prove it without a database or
   * a bundler. The two are held together by that vector file, which asserts the
   * same cases the format spec documents — including the leading zero, whose
   * whole story is in the comment on `YEAR_RE`.
   */
  const yearText = input.style_year == null ? "" : String(input.style_year).trim();
  if (yearText !== "" && !/^[1-9][0-9]{3}$/.test(yearText)) {
    problems.push({
      section: "style",
      message: `Year must be 4 digits (e.g. 2026) — "${yearText}" is not.`,
    });
  }

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

  /**
   * A component must belong to one of THIS style's coordinates.
   *
   * The Components picker is scoped so this cannot be reached by choosing
   * badly. It is reached by the coordinate moving out from under a component
   * that was already correct — deleting a Coordinates row, or switching Unit
   * to Piece, which trims the grid to its first row.
   *
   * SO THE RULE EXISTS TO REFUSE A SAVE, NOT TO CATCH A TYPO. The alternative
   * is to drop the orphaned components automatically, which is data loss the
   * operator never sees: deleting BOTTOM by mistake would silently take its
   * four components with it. Blocking here puts the choice back on them —
   * re-add the coordinate, or remove the components.
   */
  const orphans = orphanComponents(input.components ?? [], input.coordinates ?? []);
  if (orphans > 0) {
    problems.push({
      section: "components",
      message:
        orphans === 1
          ? "1 component is filed under a coordinate this style no longer has — give it one of the style's coordinates, or remove it."
          : `${orphans} components are filed under a coordinate this style no longer has — give them one of the style's coordinates, or remove them.`,
    });
  }

  return problems;
}
