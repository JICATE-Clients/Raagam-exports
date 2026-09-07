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
 * HAS THIS LINE GOT ALL THE COORDINATE ROWS IT MAY HAVE? — the one rule behind
 * both "+ Add coordinate" being hidden and `addStyleCoordinate` refusing.
 *
 * ## IT COUNTS ROWS, NOT FILLED ONES, AND THAT IS THE WHOLE POINT
 *
 * Both call sites used to read `filledCoordinates(rows) >= cap.max`, which was
 * correct only while something wrote the coordinate FOR the operator. It did:
 * answering Order Unit = PCS seeded a PIECES row, so a Pcs line was at 1 filled
 * the instant it was answered and the button hid itself.
 *
 * That seeding was removed on 2026-08-29 ("no need to choose PIECES also, which
 * is just one coordinate … whatever it is"), and the button came back — a Pcs
 * line now sits on ONE BLANK ROW, `filledCoordinates` reads 0, and 0 >= 1 is
 * false. The client reported it the same day, against screenshot 2545: "if I
 * choose order unit as PCS, no need to '+ Add coordinate' option — hide it,
 * because it is only one for the order unit PCS."
 *
 * A blank row is a SLOT, and a slot the operator is about to fill still occupies
 * the line's one allowance. So the arity question is about rows.
 *
 * **This is the second bug that removal caused and the first one it exposed.**
 * Counting filled rows was already wrong on a Set: 5 filled plus the blank 6th
 * read as 5, so the button showed at the cap — and `addStyleCoordinate` then
 * declined it anyway, through its separate "last row is still blank" guard. A
 * button that renders and does nothing is the same defect, one row further
 * along, and it had been there since 0392.
 *
 * ## IT MUST NOT FIRE ON AN EMPTY LINE, AND DOES NOT
 *
 * `ChildGrid`'s `seedRow` effect declines to seed while `hideAdd` is true, so a
 * rule that hid the button at zero rows would leave a Pcs line with no row, no
 * button and no way in. Zero is below every cap (`COORDINATE_LIMITS.piece.min`
 * is 1), so the sequence settles on its own: 0 rows -> not full -> seed fires ->
 * 1 row -> full -> button hides. Deleting the row re-opens it and re-seeds.
 *
 * ## AN OVER-CAP LINE IS FULL, NOT BROKEN
 *
 * Switch a three-coordinate style to PCS and this answers true — the button
 * goes, the three rows stay, and `styleProblems` says why the save is refused.
 * Deleting entered rows because a dropdown changed is the data loss
 * `coordinateCap` refuses in the same words.
 */
export function coordinatesFull(
  unitKind: string | null | undefined,
  rows: readonly CoordinateLike[],
): boolean {
  return rows.length >= coordinateCap(unitKind).max;
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
 * THE ONE MASTER ROW THAT IS SPECIAL — "PIECES" BY CODE.
 *
 * This is `pieceCoordinateId`, restored 2026-09-05 by client instruction after
 * being deleted outright on 2026-08-29 ("no need to choose PIECES also, which
 * is just one coordinate … whatever it is"). Read the history before touching
 * this function again — it explains a real failure mode this reintroduces on
 * purpose, with the client's eyes open to it the second time.
 *
 * ## WHAT WAS WRONG WITH IT THE FIRST TIME, AND IS STILL TRUE
 *
 * The cap is a COUNT, not a name: `coordinateCap` says a Piece garment has one
 * coordinate, never which one, and nothing stops a customer's Pcs order being
 * filed under TOP. Matching on the string "PIECES" turns a rule about arity
 * into a rule about vocabulary — the same trap AGENTS.md's "Near misses"
 * section records a seeded word list falling into elsewhere — and it silently
 * couples the screen to a row nobody promised: rename PIECES to PIECE on the
 * GAR master and this goes back to returning null, with no error to read.
 *
 * ## WHY IT IS BACK ANYWAY
 *
 * The client asked for the DEFAULT specifically, not merely the arity cap: an
 * Order Unit of PCS should hand the operator a filled Coordinate cell, not a
 * blank one they still have to open. `impliedCoordinateId` below cannot do
 * this — it only ever reads a coordinate ALREADY on the line, by design, so
 * that it stays name-blind (`scripts/check-style-rules.mts` asserts exactly
 * that and is untouched by this restoration). Something has to write the
 * FIRST coordinate onto an empty Pcs line, and there is no arity-only way to
 * decide WHICH master row that should be.
 *
 * ## THE SCOPE IS NARROWED FROM THE ORIGINAL, DELIBERATELY
 *
 * This function only ANSWERS "which row is PIECES, if any" — it does not
 * decide when to write it, and it is never wired into `impliedCoordinateId`,
 * `coordinatesLocked` or `coordinatesFull`. The screen (`answerUnitKind` in
 * `garment-order-screen.tsx`) calls it once, only when Order Unit is answered
 * "piece" on a line whose coordinate is still blank, and writes a normal,
 * fully editable value — never `disabled`, for the same reason the 2026-08-29
 * history gives: a default the operator cannot overrule is a constraint, not
 * a default, and a Pcs order that turns out to need a different coordinate
 * must stay one click away from correcting it.
 *
 * NULL IS A SILENT NO-OP, on purpose. A master with no row coded PIECES, or a
 * renamed one, leaves the cell exactly as blank as it always was rather than
 * throwing — the same "leave the cell alone" contract `componentTypeForCategory`
 * documents above. The operator loses a convenience, never a save.
 */
export const PIECE_COORDINATE_CODE = "PIECES";

export type CoordinateMasterRow = { id: string; code?: string | null };

export function pieceCoordinateId(
  coordinates: readonly CoordinateMasterRow[],
): string | null {
  return (
    coordinates.find((c) => (c.code ?? "").trim().toUpperCase() === PIECE_COORDINATE_CODE)?.id ??
    null
  );
}

/**
 * THE COORDINATE EVERY COMPONENT OF THIS LINE BELONGS TO, when there is only
 * one it could be — the value the Components grid pre-fills (client 2026-08-29:
 * "because there is only one coordinate option, no dropdown selection is
 * required, and the user is spared from manual cursor clicks").
 *
 * READS THE LINE'S OWN GRID, AND NEVER A MASTER ROW'S NAME. It asks only "does
 * this line have exactly one coordinate?", so a PCS order filed under TOP fills
 * its components with TOP — whichever coordinate it is, which is the client's
 * own correction ("no need to choose PIECES also, which is just one coordinate …
 * whatever it is", 2026-08-29).
 *
 * THAT IS WHY THIS FUNCTION SURVIVED AND ITS SIBLING DID NOT. The seeder asked
 * "which master row means one garment?" — a question about vocabulary, and one
 * a renamed row silently breaks. This asks a question about ARITY, which the
 * data answers on its own. See the note where `pieceCoordinateId` used to be.
 *
 * NULL IS THE ANSWER FOR EVERY OTHER STATE, and each of them is a state where
 * the operator must choose:
 *
 *   - a SET line — several coordinates, which is the whole point of a set;
 *   - a PCS line with no coordinate yet — there is nothing to fill with;
 *   - a PCS line carrying MORE than one — legacy data, or a line switched to
 *     PCS after its coordinates were entered. `styleProblems` already refuses
 *     to save that, and the operator fixes it by hand; pre-filling one of
 *     several would be picking for them.
 *   - an UNANSWERED unit — `unitKindFromCoordinates` derives PCS from a count
 *     of one, and reading that here would close the loop `coordinateCap`'s note
 *     spells out: a derived PCS would lock the grid that derived it.
 */
export function impliedCoordinateId(
  unitKind: string | null | undefined,
  rows: readonly CoordinateLike[],
): string | null {
  if (unitKind !== "piece") return null;
  const ids = [...styleCoordinateIds(rows)];
  return ids.length === 1 ? ids[0] : null;
}

/**
 * IS THE LINE'S ONE COORDINATE SETTLED — i.e. may its ✕ be hidden?
 *
 * ## THE NAME IS WIDER THAN THE JOB, AND THE JOB SHRANK ON PURPOSE
 *
 * It was written for the whole of "the coordinates grid displays exactly one
 * row and disables any manual adding, editing, or deletion of coordinates"
 * (client 2026-08-29) and greyed the picker as well as hiding the ✕. The client
 * released the EDITING half the same day — "just release, no need to choose
 * there" (screenshot 2544) — so exactly one caller reads this now, and it reads
 * it for `hideRemove`.
 *
 * **The name is deliberately NOT changed to `coordinateRemovable`.** Every
 * assertion in `check-style-rules.mts` is keyed to it, including the invariant
 * that matters most ("no locked grid is one the save would refuse"), and a
 * rename would churn those without changing a single answer. What was wrong was
 * never this predicate — it returns exactly what it always did — but the number
 * of things the screen hung off it. Read the caller for what it gates.
 *
 * ADDING IS NOT THIS. `coordinateCap` hides "+ Add" and always did; it is the
 * Style master's rule (a Piece garment has one coordinate, a Set has several)
 * rather than anything this instruction introduced.
 *
 * True only when the line is ALREADY in the state the rule describes — PCS, one
 * coordinate, and no second row to argue about. That is narrower than the
 * instruction reads, and the narrowing is the point rather than a hedge:
 *
 * **A lock is only safe where there is nothing left to fix.** Switch a
 * three-coordinate line to PCS and `styleProblems` refuses the save ("A Piece
 * style allows at most 1 coordinate — there are 3"). Locking THAT grid would
 * leave the operator holding a line they cannot save and cannot repair, with
 * the only remedy being to switch the unit back — a dead end produced by a rule
 * meant to save keystrokes. So a line that is over its cap stays editable until
 * it is back inside it, and locks itself the moment it is.
 *
 * The same reasoning covers the empty case from the other side: a PCS line with
 * no coordinate is unlocked so the seed, or the operator, can put one there.
 *
 * Deliberately NOT a second reading of `coordinateCap`. That answers "may this
 * line grow?"; this answers "is its one coordinate settled enough that removing
 * it could only produce an error?", and the two differ on exactly the rows above
 * — over the cap, growth is refused while the ✕ must stay reachable.
 */
export function coordinatesLocked(
  unitKind: string | null | undefined,
  rows: readonly CoordinateLike[],
): boolean {
  return impliedCoordinateId(unitKind, rows) !== null;
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
 * ONE PREDICATE, THREE READERS, and they must not drift. The save path drops a
 * component row that holds nothing (`normalizeStyleComponents`), the screen
 * marks a row's mandatory cells `required` only once it is started, and the
 * "+ Add" button DECLINES while the last row is unstarted so Enter cannot stack
 * blanks. Those are the same question asked from three directions: require a
 * field on a row that will be dropped and the operator is caged on a row they
 * never meant to add; drop a row whose fields were required and a half-filled
 * component vanishes silently; disagree with either and "+ Add" grows a row the
 * save then throws away.
 *
 * The trailing blank row is the case this exists for. `ChildGrid` seeds one, and
 * `material-attribute-master-screen.tsx` learned the same lesson with its star
 * row: "requiring it would cage the operator on a row they never meant to add".
 *
 * ## `impliedCoordinateId` — A VALUE THE SYSTEM PUT THERE IS NOT A START
 *
 * The third reader arrived with the PCS auto-fill (client 2026-08-29): on a
 * Piece line a new component row is born holding the line's only coordinate,
 * so the operator does not have to open a one-item dropdown per row. Without
 * this argument that row reads as started to all three readers at once, and
 * each of them then does the wrong thing:
 *
 *   - `required` fires on a row nobody has touched, and a blank mandatory cell
 *     HOLDS THE CURSOR (AGENTS.md) — so adding a component would trap the
 *     operator in it;
 *   - "+ Add" stops declining, so Enter stacks blank rows without limit;
 *   - the save keeps a row with a coordinate and no component — junk that
 *     `orphanComponents` cannot flag, because its coordinate is perfectly valid.
 *
 * A convenience that quietly turns three rules off is worse than the two clicks
 * it saved. So pass the implied coordinate wherever one exists and the predicate
 * discounts exactly that one value — any OTHER coordinate is still a start,
 * because choosing it took a decision.
 *
 * OPTIONAL, AND OMITTING IT IS THE OLD BEHAVIOUR. The Style master's own grid
 * has no auto-fill and passes nothing.
 */
export type ComponentRowLike = {
  coordinate_id?: string | null;
  component_id?: string | null;
  fabric_category_id?: string | null;
  comp_type?: string | null;
  item_id?: string | null;
};

export function componentRowStarted(
  r: ComponentRowLike,
  impliedCoordinate?: string | null,
): boolean {
  const coordinateChosen =
    !!r.coordinate_id && r.coordinate_id !== (impliedCoordinate ?? null);
  return !!(
    coordinateChosen ||
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
  /* WIDENED 2026-08-31 from `ComponentLike` (coordinate only) so the duplicate
     rule can see `component_id`. `ComponentLike` is assignable to this, so every
     existing caller is untouched. */
  components?: readonly ComponentRowLike[];
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

  /* THE WORDING MOVED TO `coordinateCountMessage` (2026-08-31) and the branch
     did not change — the Garment Order's Style(s) tab now applies the identical
     rule to each of its LINES, and two copies of a sentence about arity is how
     one screen ends up saying "exactly 1" while the other says "at most 1". */
  const countMessage = coordinateCountMessage(input.unit_kind, input.coordinates ?? []);
  if (countMessage) {
    problems.push({ section: "coordinates", message: countMessage });
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
  /* Worded once, in `orphanComponentsMessage` — same reason as the count above. */
  const orphans = orphanComponentsMessage(input.components ?? [], input.coordinates ?? []);
  if (orphans) {
    problems.push({ section: "components", message: orphans });
  }

  /**
   * NO COMPONENT TWICE UNDER ONE COORDINATE — ON THE MASTER TOO (2026-08-31).
   *
   * THE MASTER WAS THE UNGUARDED HALF, and that is why this is here rather than
   * only on the order line. `garment_style_components` has NO unique index (all
   * 12 migrations touching it declare non-unique ones) and
   * `normalizeComponents` in `actions.ts` has no de-dupe pass at all — only the
   * blank filter and the renumber. So N identical rows went screen-to-database,
   * and Fabric BOM, MBA and TA Plan all read that table.
   *
   * THIS IS THE WHOLE GUARD, AND IT IS ENOUGH. `garmentStyleInput` replays
   * `styleProblems` in its `superRefine`, so the rule reaches the Save button,
   * the rail badge and the server action from this one place. No migration was
   * added: a unique index would refuse rows that ALREADY EXIST in the live
   * table, and nothing here decides which of a duplicate pair is the real one.
   * Blocking the next save is the honest repair — the same call `orphanComponents`
   * makes one paragraph up ("the alternative is data loss the operator never
   * sees").
   */
  const dups = duplicateComponentsMessage(input.components ?? []);
  if (dups) {
    problems.push({ section: "components", message: dups });
  }

  return problems;
}

/* ==========================================================================
 * THE STYLE LINE'S OWN COMPLETENESS (client 2026-08-31)
 *
 * "Several fields in the Style Creation screen are promoted to strictly
 * mandatory status ... to prevent incomplete data entries that cause empty rows
 * in downstream planning and operational reports."
 *
 * WHAT FOLLOWS IS ABOUT ONE ROW OF A GRID, WHICH IS WHY IT IS NOT `styleProblems`
 * ABOVE. That function judges the Style MASTER — one record, its problems tagged
 * with the master's own rail sections. These judge ONE LINE of the Garment
 * Order's Style(s) tab, where every problem lives in the same tab and what the
 * operator needs instead is WHICH CELL of which row to look at. Different
 * question, different return shape.
 *
 * THE TWO SHARED RULES ARE SHARED, not restated: the coordinate-count message
 * and the orphan message are each one function, called from both. They drifted
 * once already in this module's history (`comp_type` had four readings), and a
 * message that says "at most 1 coordinate" on one screen and "exactly 1" on the
 * other is the same defect wearing prose.
 * ========================================================================== */

/** One ticked size on a style line. */
export type SizeLike = { size_id?: string | null };

/**
 * A style LINE, declared structurally so the screen can pass its live row and
 * the server can pass its payload without either building the other's shape.
 * The same reasoning `StyleRuleInput` above records.
 *
 * `po_qty`, `article_no` and `approved_sample_id` are governed by NO rule below.
 * They are here only so `styleLineStarted` can see a row somebody began from the
 * commercial end — an operator who typed a PO Qty and nothing else has started a
 * line, and a completeness rule that could not see that would let exactly the
 * half-filled row the client is asking about through.
 */
export type StyleLineLike = {
  style_ref_no?: string | null;
  style_category_id?: string | null;
  unit_kind?: string | null;
  description?: string | null;
  po_qty?: string | number | null;
  article_no?: string | null;
  approved_sample_id?: string | null;
  coordinates?: readonly CoordinateLike[];
  sizes?: readonly SizeLike[];
  components?: readonly ComponentRowLike[];
};

/**
 * WHICH CELL IS AT FAULT. Not a DOM id — this module is pure and must stay
 * loadable by plain Node (see the header) — but a name the screen maps to one,
 * so `revealFirstProblem` can land the cursor rather than merely switching tab.
 */
export const STYLE_LINE_FIELDS = [
  "style",
  "style_category",
  "order_unit",
  "description",
  "coordinates",
  "sizes",
  "components",
] as const;

export type StyleLineField = (typeof STYLE_LINE_FIELDS)[number];

export type StyleLineProblem = { field: StyleLineField; message: string };

const filled = (v: string | number | null | undefined) => String(v ?? "").trim() !== "";

/**
 * HAS THE OPERATOR STARTED THIS LINE?
 *
 * THE WHOLE RULE HANGS ON THIS, and it is the same argument
 * `componentRowStarted` above makes one level down. `ChildGrid` seeds a blank
 * row so Tab has a field to land on; a rule that called that row incomplete
 * would put a red badge on the Style(s) tab of an order nobody has typed a
 * character into, refuse to let the operator leave it, and — since a blank
 * mandatory cell HOLDS THE CURSOR (AGENTS.md) — cage them in a row they never
 * asked for. A new order would open trapped.
 *
 * So an untouched row is not wrong, it is empty, and the save drops it. Only a
 * row somebody has begun has to be finished.
 *
 * THE IMPLIED COORDINATE IS DISCOUNTED, exactly as `componentRowStarted`
 * discounts it: on a Pcs line every component row is BORN holding the line's one
 * coordinate, so counting that as a start would make a line "started" by a value
 * the system wrote. `impliedCoordinateId` is computed here rather than passed in
 * so the two readers cannot be handed different answers.
 */
export function styleLineStarted(r: StyleLineLike): boolean {
  const implied = impliedCoordinateId(r.unit_kind, r.coordinates ?? []);
  return !!(
    filled(r.style_ref_no) ||
    r.style_category_id ||
    filled(r.unit_kind) ||
    filled(r.description) ||
    filled(r.po_qty) ||
    filled(r.article_no) ||
    r.approved_sample_id ||
    filledCoordinates(r.coordinates ?? []) > 0 ||
    (r.sizes ?? []).some((z) => !!z.size_id) ||
    (r.components ?? []).some((c) => componentRowStarted(c, implied))
  );
}

/**
 * THE COORDINATE COUNT, WORDED ONCE — read by `styleProblems` (the master) and
 * by `styleLineProblems` (the order line). Null when the count is legal, or when
 * the unit is unanswered and there is therefore no range to be outside of.
 *
 * A LEGACY STYLE WITH NO `unit_kind` IS NOT INVALIDATED. Every style created
 * before 2026-08-10 has none, and `coordinateLimit` returning null is what keeps
 * this silent on them rather than declaring historical records broken.
 */
export function coordinateCountMessage(
  unitKind: string | null | undefined,
  coordinates: readonly CoordinateLike[],
): string | null {
  const limit = coordinateLimit(unitKind);
  if (!limit) return null;
  const n = filledCoordinates(coordinates);
  if (n < limit.min) {
    return limit.min === limit.max
      ? `A Piece style needs exactly ${limit.min} coordinate.`
      : `A Set style needs at least ${limit.min} coordinates — there ${n === 1 ? "is" : "are"} ${n}.`;
  }
  if (n > limit.max) {
    return `A ${unitKind === "piece" ? "Piece" : "Set"} style allows at most ${limit.max} coordinate${limit.max === 1 ? "" : "s"} — there are ${n}.`;
  }
  return null;
}

/**
 * THE DUPLICATE MESSAGE, WORDED ONCE — the master (`styleProblems`) and the
 * order line (`styleLineProblems`) both say it, and a rule about double-counted
 * trim consumption must not read two ways depending on which screen found it.
 */
export function duplicateComponentsMessage(
  components: readonly ComponentRowLike[],
): string | null {
  const n = duplicateComponents(components);
  if (n === 0) return null;
  return n === 1
    ? "A component is listed twice under the same coordinate — remove the repeat, or file it under another coordinate."
    : `${n} components are listed twice under the same coordinate — remove the repeats, or file them under another coordinate.`;
}

/** The orphan message, worded once, for the same reason as the one above. */
export function orphanComponentsMessage(
  /* THE WIDER OF THE TWO ROW SHAPES. `ComponentLike` declares
     `coordinate_id` present-and-nullable; `ComponentRowLike` declares it
     optional, because a screen row may simply not carry the key yet. Taking
     the wider one here means both callers pass their own rows unconverted —
     the master its payload, the order line its live grid state — and the
     `?? null` below is the one place the two readings meet. */
  components: readonly ComponentRowLike[],
  coordinates: readonly CoordinateLike[],
): string | null {
  const n = orphanComponents(
    components.map((c) => ({ coordinate_id: c.coordinate_id ?? null })),
    coordinates,
  );
  if (n === 0) return null;
  return n === 1
    ? "1 component is filed under a coordinate this style no longer has — give it one of the style's coordinates, or remove it."
    : `${n} components are filed under a coordinate this style no longer has — give them one of the style's coordinates, or remove them.`;
}

/* --------------------------------------------------------------------------
 * NO COMPONENT TWICE UNDER ONE COORDINATE (client 2026-08-31)
 *
 * "Allowing a user to accidentally add 'Neck Rib' twice results in duplicated
 * trim consumption calculations, which corrupts the final automated Material
 * BOM."
 *
 * ## THE KEY IS THE PAIR, AND THE CHOICE OF KEY IS THE WHOLE RULE
 *
 * The instruction as written — "that component must be filtered out of the
 * dropdown for row 2, row 3" — reads as "a component appears at most once per
 * STYLE". It is deliberately implemented one notch looser than that, on
 * (coordinate, component), and the reason is that a set garment legitimately
 * repeats a part: a two-coordinate style has a FRONT BODY on the TOP and a FRONT
 * BODY on the BOTTOM, and those are two different panels cut from two different
 * fabrics. Hiding the second is not a stricter rule, it is a garment that cannot
 * be entered — the shape AGENTS.md records under "Mandatory fields" as
 * unsatisfiable rather than strict.
 *
 * On a Pcs line the two readings COINCIDE, because every row of that grid holds
 * the line's single coordinate — so the client's literal case ("Neck Rib twice")
 * behaves exactly as asked, and the loosening is invisible except on the sets
 * where it is load-bearing.
 *
 * ## WHAT THIS DOES *NOT* MATCH, AND THAT IS DELIBERATE
 *
 * 0457's unique index is `(amendment, style, coordinate, component,
 * fabric_category)` — one column wider — because FRONT BODY in single jersey
 * beside FRONT BODY in 1x1 rib is a contrast yoke. This rule is therefore
 * STRICTER than the database: it refuses a pair the index would accept.
 *
 * That is the client's call, chosen over matching the index (2026-08-31), and it
 * costs the contrast yoke, which now has to be modelled as one component row.
 * The BOM argument is what carried it: a duplicated pair is far more often a
 * mis-click that double-budgets a trim than it is a yoke, and the failure is
 * silent money. If the yoke comes back, widen `componentPairKey` to include
 * `fabric_category_id` and the index and the rule agree again — the reason this
 * is ONE function and not a comparison written at three call sites.
 * -------------------------------------------------------------------------- */

/**
 * The pair a component row is unique on. Null while the row names no component
 * — an unanswered row is not a duplicate of anything, and the grid's own
 * `required` says so on its own.
 *
 * A row with NO coordinate keys on `""`, so two blank-coordinate rows naming one
 * component DO collide. That is right rather than incidental: on a Set line the
 * operator has simply not filed them yet, and the pair is as duplicated as it
 * will ever be.
 */
function componentPairKey(c: ComponentRowLike): string | null {
  if (!c.component_id) return null;
  return `${c.coordinate_id ?? ""}::${c.component_id}`;
}

/** How many rows repeat a (coordinate, component) pair some earlier row already
 *  holds. The FIRST occurrence is never counted — the operator is being told how
 *  many rows to fix, not how many rows are involved. */
export function duplicateComponents(components: readonly ComponentRowLike[]): number {
  const seen = new Set<string>();
  let dups = 0;
  for (const c of components) {
    const key = componentPairKey(c);
    if (!key) continue;
    if (seen.has(key)) dups++;
    else seen.add(key);
  }
  return dups;
}

/**
 * The component ids already spoken for under one coordinate — what the dropdown
 * hides.
 *
 * THE CALLER PASSES SIBLINGS, NOT THE WHOLE GRID, and that is not a convenience:
 * a row must never filter itself out of its own list. Dropping the value a row
 * already holds is the "Disabled rows" data loss AGENTS.md refuses everywhere —
 * the cell would render filled-then-empty and blank the FK on the next save. The
 * screen owns the row keys, so it owns the exclusion; this function owns the
 * rule.
 */
export function componentsTakenUnder(
  siblings: readonly ComponentRowLike[],
  coordinateId: string | null,
): Set<string> {
  const taken = new Set<string>();
  for (const c of siblings) {
    if (!c.component_id) continue;
    if ((c.coordinate_id ?? null) !== (coordinateId ?? null)) continue;
    taken.add(c.component_id);
  }
  return taken;
}

/**
 * WHICH KEYS APPEAR MORE THAN ONCE, and how many times (client 2026-08-31: "a
 * UNIQUE style identifier must be selected or entered before proceeding").
 *
 * ## IT TAKES KEYS, NOT ROWS, AND THAT IS THE WHOLE DESIGN
 *
 * `style_ref_no` is the Orders module's TEXT join key, and normalising it is
 * `styleKey`'s job — one function, in its own file, whose header says outright
 * that "two copies of a key rule stay identical exactly until one of them is
 * 'improved'". This module cannot import it: `rules.ts` declares itself
 * import-free so `scripts/check-style-rules.mts` can load it with plain Node,
 * and reaching for `@/lib/...` breaks that while a `.ts` extension breaks the
 * Next build. So the CALLER normalises and this counts. The rule stays testable;
 * the key stays singular.
 *
 * ## WHY IT MATTERS MORE THAN AN ORDINARY DUPLICATE
 *
 * Two lines sharing a ref is not an untidy list — it is silent corruption.
 * Price Details, Combos, Quantities and Approval Qty all resolve on this text,
 * so a repeated ref makes every one of them ambiguous; and
 * `normalizeStyleComponents` de-dupes on `(styleKey, coordinate, component,
 * fabric_category)`, so the two lines' component grids are MERGED and pruned
 * against each other at save. The operator sees two rows and stores one.
 *
 * Blanks are the caller's to drop (`styleKey` returns "" for an unnamed row):
 * two unnamed lines are two lines nobody has started, not a collision.
 */
export function duplicateRefCounts(
  keys: readonly string[],
): { ref: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const k of keys) {
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  /* INSERTION ORDER, which for a Map is first-seen order — so the message names
     the repeats in the order the operator entered them, not alphabetically. */
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([ref, count]) => ({ ref, count }));
}
/**
 * EVERYTHING UNFINISHED ABOUT ONE STYLE LINE, in the order the row reads.
 *
 * Empty on a line nobody has started — see `styleLineStarted`. Every message is
 * a completeness claim about the record, which is why the screen files them all
 * as `kind: "custom"`: `isBlocking` in `lib/screens/validity.ts` treats those as
 * blocking, and blocking is the point — the client's whole reason for the
 * promotion is that these rows reach downstream reports.
 *
 * DESCRIPTION IS IN HERE AND THAT IS A REVERSAL. It has been an optional remark
 * since the tab was built; the client made it mandatory on 2026-08-31 because
 * "reports pull directly from this text to identify style specifications".
 *
 * SO IS ORDER UNIT, and that one reverses a decision made four days earlier. The
 * 2026-08-27 note on the cell reads: "NOT `required`, deliberately ... holding an
 * operator on a two-option dropdown they have no way to skip would cage every
 * half-entered line." The premise was wrong, not the caution: `keyFills` in
 * `lib/focus.ts` gives a native `<select>` its ↑/↓ back under a hold precisely
 * so the operator can ANSWER it — a hold refuses movement and never refuses
 * choosing. The cage it feared cannot happen, and Ctrl+Del still removes the row.
 *
 * COORDINATES ARE REQUIRED, AND THE "Pcs" DEFAULT IS BACK (2026-09-05). The
 * client's original sentence pairs the two ("must be defined. If the Order Unit
 * is Pcs, it defaults to Pcs automatically"); the second half was built, then
 * withdrawn on 2026-08-29, then asked for again on 2026-09-05 — see
 * `pieceCoordinateId`'s own note for the seeding itself and why this rule does
 * not need to change to carry it: a defaulted coordinate is a normal, editable
 * value by the time `styleLineProblems` ever sees the row, so "at least one
 * coordinate" is satisfied the same way whether the operator typed it or the
 * default did.
 */
export function styleLineProblems(r: StyleLineLike): StyleLineProblem[] {
  const out: StyleLineProblem[] = [];
  if (!styleLineStarted(r)) return out;

  if (!filled(r.style_ref_no)) {
    out.push({ field: "style", message: "Style is required." });
  }
  if (!r.style_category_id) {
    out.push({ field: "style_category", message: "Style Category is required." });
  }
  if (!filled(r.unit_kind)) {
    out.push({ field: "order_unit", message: "Order Unit is required — Pcs or Set." });
  }
  if (!filled(r.description)) {
    out.push({ field: "description", message: "Description is required." });
  }

  const coordinates = r.coordinates ?? [];
  if (filledCoordinates(coordinates) === 0) {
    /* SAID SEPARATELY FROM THE COUNT RULE BELOW, because the count rule is
       silent on a line whose unit is unanswered — and "no coordinate at all" is
       wrong whatever the unit turns out to be. Without this a Set line with an
       empty grid would report only the missing Order Unit and look finished the
       moment it was answered. */
    out.push({ field: "coordinates", message: "Name at least one coordinate." });
  } else {
    const count = coordinateCountMessage(r.unit_kind, coordinates);
    if (count) out.push({ field: "coordinates", message: count });
  }

  if (!(r.sizes ?? []).some((z) => !!z.size_id)) {
    out.push({ field: "sizes", message: "Tick at least one size." });
  }

  const components = r.components ?? [];
  const implied = impliedCoordinateId(r.unit_kind, coordinates);
  /* STARTED ROWS ONLY — the client's own wording is "if a style has components,
     the component entries must be fully defined". The trailing blank row every
     grid seeds is not an entry. */
  const unfinished = components.filter(
    (c) => componentRowStarted(c, implied) && (!c.coordinate_id || !c.component_id),
  ).length;
  if (unfinished > 0) {
    out.push({
      field: "components",
      message:
        unfinished === 1
          ? "1 component row is half-filled — give it a coordinate and a component, or remove it."
          : `${unfinished} component rows are half-filled — give each a coordinate and a component, or remove them.`,
    });
  }

  const dups = duplicateComponentsMessage(components);
  if (dups) out.push({ field: "components", message: dups });

  const orphans = orphanComponentsMessage(components, coordinates);
  if (orphans) out.push({ field: "components", message: orphans });

  return out;
}
