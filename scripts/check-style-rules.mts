// Verification vectors for lib/orders/styles/rules.ts.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-style-rules.mts
//
// These rules run in three places at once — the rail's red badges, the Save
// button's `canSave`, and `garmentStyleInput`'s superRefine (so a lib/data-io
// import cannot bypass them). One function serves all three precisely so they
// cannot disagree, which makes this file the only place that agreement is
// actually demonstrated rather than asserted in a comment.
//
// `rules.ts` imports nothing at all, which is what lets these be proved without
// a database, a browser or a test framework — and why every rule the Style
// screen enforces lives there rather than in the component.
//
// Exits non-zero on the first mismatch so it can gate a commit if wanted.

import {
  COORDINATE_LIMITS,
  componentRowStarted,
  componentTypeForCategory,
  coordinateLimit,
  coordinateCap,
  coordinatesFull,
  coordinatesLocked,
  filledCoordinates,
  impliedCoordinateId,
  unitKindFromCoordinates,
  orphanComponents,
  styleCoordinateIds,
  styleProblems,
  styleLineProblems,
  styleLineStarted,
  duplicateComponents,
  componentsTakenUnder,
  coordinateCountMessage,
  orphanComponentsMessage,
  duplicateComponentsMessage,
  duplicateRefCounts,
  type StyleLineLike,
  type CoordinateLike,
  type ComponentLike,
} from "../lib/orders/styles/rules.ts";
import { readFileSync } from "node:fs";

let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

const TOP = "11111111-1111-1111-1111-111111111111";
const BOTTOM = "22222222-2222-2222-2222-222222222222";
const SLEEVE_SET = "33333333-3333-3333-3333-333333333333";

const coord = (id: string | null): CoordinateLike => ({ coordinate_id: id });
const comp = (id: string | null): ComponentLike => ({ coordinate_id: id });

/** Only the section keys — the wording is allowed to change without breaking
 *  every vector, but WHICH TAB a problem is filed against is the load-bearing
 *  part: a problem that names the wrong section leaves Save dead with nothing
 *  on screen to explain it. */
const sections = (i: Parameters<typeof styleProblems>[0]) =>
  styleProblems(i).map((p) => p.section);

// ---------- filled coordinates ignore blank rows ----------
// The grid seeds a blank row; a row the operator never answered is not a
// coordinate, and normalizeCoordinates drops it on save anyway.
check("filledCoordinates ignores blanks", filledCoordinates([coord(TOP), coord(null)]), 1);
check("filledCoordinates of nothing", filledCoordinates([]), 0);

// ---------- the coordinate cap ----------
check("piece limit", coordinateLimit("piece"), { min: 1, max: 1 });
check("set limit", coordinateLimit("set"), { min: 2, max: 6 });
// NULL IS NOT AN ERROR. Every style predating 0392 has no unit_kind, and the
// rule must stay silent on those rather than declaring history invalid.
check("no unit kind = no rule", coordinateLimit(null), null);
check("unknown unit kind = no rule", coordinateLimit("bundle"), null);

/* -------------------------------------------------------------------------
 * THE CAP THE ORDER SCREEN GROWS A LINE TO (client 2026-08-27: "if Order Unit
 * is PCS, just the single coordinate — hide the add coordinate option; if they
 * choose SET they can add multiple").
 *
 * `coordinateCap` is `coordinateLimit` with the unanswered case decided. The
 * fallback is the half that matters: an unanswered unit is DERIVED from the
 * coordinate count, so capping by it closes a loop the order screen hit once
 * on 2026-08-25 — one coordinate derives "piece", piece allows one, and no
 * line can ever hold a second.
 * ------------------------------------------------------------------------- */
console.log("\n\u00a7 coordinateCap — the Order Unit gates the coordinate grid");

check("PCS caps at one coordinate", coordinateCap("piece"), { min: 1, max: 1 });
check("SET allows up to six", coordinateCap("set"), { min: 2, max: 6 });

/* THE FALLBACK, STATED AS ITS OWN VECTOR because it is the one that stops the
   loop. Not "some range" — the CEILING, so a line can still grow to a Set
   before anyone has said which it is. */
check("unanswered falls back to the ceiling", coordinateCap(null), { min: 1, max: 6 });
check("...and so does a value that is not a kind", coordinateCap("bundle"), { min: 1, max: 6 });

/* THE LOOP, ASSERTED DIRECTLY. With one coordinate entered and no unit typed,
   the derived kind is "piece" — and if the cap read THAT, a second coordinate
   could never be added. The cap must stay above the count. */
check(
  "one coordinate and no unit: a second is still allowed",
  coordinateCap(null).max > 1,
  true,
);
check(
  "...even though the derived kind alone would say piece",
  unitKindFromCoordinates(1),
  "piece",
);

/* A LINE ALREADY OVER ITS CAP still reports the cap, and the caller is what
   leaves the extra rows alone — see the function's note. */
check("PCS still reports 1 even when three are entered", coordinateCap("piece").max, 1);

check("piece with one coordinate is fine", sections({ unit_kind: "piece", coordinates: [coord(TOP)] }), []);
check(
  "piece with none is short",
  sections({ unit_kind: "piece", coordinates: [] }),
  ["coordinates"],
);
check(
  "piece with two is over",
  sections({ unit_kind: "piece", coordinates: [coord(TOP), coord(BOTTOM)] }),
  ["coordinates"],
);
check(
  "set with one is short",
  sections({ unit_kind: "set", coordinates: [coord(TOP)] }),
  ["coordinates"],
);
check(
  "set with two is fine",
  sections({ unit_kind: "set", coordinates: [coord(TOP), coord(BOTTOM)] }),
  [],
);
check(
  "set with seven is over",
  sections({
    unit_kind: "set",
    coordinates: Array.from({ length: 7 }, (_, i) => coord(`c${i}`)),
  }),
  ["coordinates"],
);
// A legacy two-coordinate style is NOT retroactively invalid.
check(
  "legacy style with no unit kind is left alone",
  sections({ unit_kind: null, coordinates: [coord(TOP), coord(BOTTOM)] }),
  [],
);

// ---------- orphaned components ----------
check("coordinate ids ignore blanks", [...styleCoordinateIds([coord(TOP), coord(null)])], [TOP]);

check(
  "a component under a declared coordinate is fine",
  orphanComponents([comp(TOP)], [coord(TOP)]),
  0,
);
check(
  "a component with NO coordinate is not an orphan",
  orphanComponents([comp(null)], [coord(TOP)]),
  0,
);
check(
  "a component under an undeclared coordinate is an orphan",
  orphanComponents([comp(BOTTOM)], [coord(TOP)]),
  1,
);
check(
  "orphans are counted, not just detected",
  orphanComponents([comp(BOTTOM), comp(BOTTOM), comp(TOP)], [coord(TOP)]),
  2,
);
// The rule fires whatever unit_kind says — unlike the cap. It can only ever
// trigger on data that is genuinely self-contradictory, so nothing valid is
// retroactively broken by it.
check(
  "orphans are caught on a legacy style too",
  sections({ unit_kind: null, coordinates: [coord(TOP)], components: [comp(BOTTOM)] }),
  ["components"],
);
check(
  "the orphan problem is filed against COMPONENTS, not coordinates",
  sections({ unit_kind: "set", coordinates: [coord(TOP), coord(BOTTOM)], components: [comp(SLEEVE_SET)] }),
  ["components"],
);
// Both rules can be live at once, and the rail has to show both counts.
check(
  "cap and orphan problems coexist, coordinates first",
  sections({ unit_kind: "piece", coordinates: [], components: [comp(TOP)] }),
  ["coordinates", "components"],
);

// ---------- THE REGRESSION THIS COMMIT EXISTS FOR ----------
//
// Switching Unit Type to Piece trims the Coordinates grid to its first row.
// Before this rule, the components under the dropped coordinate were silently
// orphaned: nothing on screen said so, and the save went through.
{
  const before = { unit_kind: "set", coordinates: [coord(TOP), coord(BOTTOM)], components: [comp(TOP), comp(BOTTOM)] };
  check("a valid Set style is clean", sections(before), []);
  const afterTrim = { ...before, unit_kind: "piece", coordinates: [coord(TOP)] };
  check("trimming to Piece surfaces the stranded component", sections(afterTrim), ["components"]);
}

// Deleting a coordinate row is the same failure by a different route.
check(
  "deleting a coordinate surfaces its components",
  sections({ unit_kind: "set", coordinates: [coord(TOP), coord(BOTTOM)], components: [comp(TOP), comp(SLEEVE_SET)] }),
  ["components"],
);

// ---------- has this component row been STARTED? ----------
//
// Two readers: the save path drops a row this calls false, and the screen marks
// a row's mandatory cells required only when it calls true. They are the same
// question from opposite ends, so a disagreement is either a caged operator on
// a row about to be discarded, or a half-filled component vanishing silently.
check("an untouched row is not started", componentRowStarted({}), false);
check("all-null is not started",
  componentRowStarted({ coordinate_id: null, component_id: null, item_id: null }), false);
check("whitespace-only comp_type is not started", componentRowStarted({ comp_type: "   " }), false);
check("a coordinate starts it", componentRowStarted({ coordinate_id: TOP }), true);
check("a component starts it", componentRowStarted({ component_id: TOP }), true);
check("a fabric starts it", componentRowStarted({ item_id: TOP }), true);
check("a structure starts it", componentRowStarted({ fabric_category_id: TOP }), true);
check("a comp_type starts it", componentRowStarted({ comp_type: "Circular" }), true);

// ---------- "TYPE" IS FETCHED FROM THE CATEGORY, NOT GUESSED ----------
//
// `categories.fabric_structure_id` is declared on the Category master, so
// picking SINGLE JERSEY answers Circular Knit exactly. The two failure modes
// that would cost data are the null ones: a category whose master record has no
// structure yet, and a category this app cannot resolve at all. Both must answer
// null so the caller leaves the operator's Type alone — writing a blank through
// is auto-populate turning into deletion.
const CATS = [
  { id: "cat-sj", fabric_structure_id: "fs-circ" },
  { id: "cat-collar", fabric_structure_id: "fs-flat" },
  { id: "cat-chambray", fabric_structure_id: "fs-woven" },
  { id: "cat-blank", fabric_structure_id: null },
];
const STRUCTS = [
  { id: "fs-circ", name: "Circular Knit" },
  { id: "fs-flat", name: "Flat Knit" },
  { id: "fs-woven", name: "Woven" },
];
check("a knit category fills Circular Knit",
  componentTypeForCategory("cat-sj", CATS, STRUCTS), "Circular Knit");
check("a flat category fills Flat Knit",
  componentTypeForCategory("cat-collar", CATS, STRUCTS), "Flat Knit");
// The superseded rule mapped to a hardcoded ["Circular","Flat"] tuple and so had
// NO answer for a woven category. CHAMBRAY and ROPE are real FABRIC categories.
check("a woven category fills Woven",
  componentTypeForCategory("cat-chambray", CATS, STRUCTS), "Woven");
check("a category with no structure leaves Type alone",
  componentTypeForCategory("cat-blank", CATS, STRUCTS), null);
check("an unknown category leaves Type alone",
  componentTypeForCategory("cat-nope", CATS, STRUCTS), null);
check("no category leaves Type alone",
  componentTypeForCategory(null, CATS, STRUCTS), null);

// ---------- A YEAR IS FOUR DIGITS, AND BLANK IS NOT A PROBLEM ----------
//
// The complaint was a `type="number"` box taking any number of digits. The
// input now caps keystrokes at four, but that half only binds the operator —
// these vectors are the half that binds `garmentStyleInput`, i.e. every other
// writer.
//
// The two shapes of value are both exercised on purpose: the SCREEN passes the
// raw string it is holding, the SCHEMA passes an already-coerced integer, and a
// rule that answered differently for 2026 and "2026" would badge the rail on a
// value the server accepts (or the reverse).
{
  const yr = (v: number | string | null | undefined) =>
    styleProblems({ style_year: v }).map((p) => p.section);

  check("a 4-digit year is fine (number)", yr(2026), []);
  check("a 4-digit year is fine (string)", yr("2026"), []);
  check("no year at all is fine", yr(null), []);
  check("an undefined year is fine", yr(undefined), []);
  // The empty string is what an untouched input holds. It must read as "not
  // answered", never as a malformed value — badging the rail red on a field
  // nobody typed in is how an optional field turns into a stopped screen.
  check("an empty year is fine", yr(""), []);
  check("a whitespace year is fine", yr("   "), []);

  check("five digits is a problem", yr(202666), ["style"]);
  check("five digits is a problem (string)", yr("20266"), ["style"]);
  check("two digits is a problem", yr(26), ["style"]);
  check("three digits is a problem", yr("202"), ["style"]);
  // A numeric range would round 2026.5 into it. Comparing the TEXT is what
  // catches that, which is why the rule reads that way rather than as
  // `>= 1000 && <= 9999`.
  check("a fractional year is a problem", yr(2026.5), ["style"]);
  // "0202" IS four digits, so the first cut of the rule accepted it — and
  // `style_year` is an `integer` column, so it saved as 202, reloaded as "202",
  // and the very same rule then refused it. A value that could be saved once
  // and not twice. This vector is why `YEAR_RE` starts at [1-9].
  check("a leading zero is a problem", yr("0202"), ["style"]);
  check("letters are a problem", yr("20AB"), ["style"]);

  // It is filed against "style", the rail row the Year field is ON. That is the
  // load-bearing half: `revealFirstProblem` hands the section key straight to
  // `goToSection`, so a problem naming a row that does not exist is a blocked
  // Save that jumps nowhere.
  check("a bad year names the section holding the field",
    styleProblems({ style_year: "20266" }).map((p) => p.section), ["style"]);

  // And it does not crowd out the rules beside it: a style can be wrong about
  // its year AND its coordinates at once, and the rail must badge both rows.
  check("a bad year does not hide a coordinate problem",
    sections({ unit_kind: "piece", coordinates: [], style_year: "20266" }),
    ["style", "coordinates"]);

  // THE FIELD'S SHAPE AND THE GUARD'S SHAPE ARE ONE RULE.
  //
  // `rules.ts` RESTATES the pattern instead of importing `YEAR_RE`, because its
  // header promises zero imports — that is what lets this whole file run under
  // `node --experimental-strip-types` with no bundler, and `formats.ts` cannot
  // be imported here anyway (it pulls in zod and extensionless relative paths
  // node's ESM loader will not resolve).
  //
  // Which means NOTHING IN THE TYPE SYSTEM STOPS THE TWO FROM DRIFTING. Two
  // regexes for one fact is how a field ends up accepting on screen what the
  // action rejects — or worse the reverse, an inline red message under a Save
  // that goes through. So the agreement is checked against the SOURCE TEXT: the
  // pattern is lifted out of both files and the literals must match character
  // for character, and then the extracted pattern is probed over every value
  // the two could disagree about.
  {
    const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const declared = /export const YEAR_RE = (\/.+?\/);/.exec(src("lib/validation/formats.ts"))?.[1];
    const restated = /!(\/.+?\/)\.test\(yearText\)/.exec(src("lib/orders/styles/rules.ts"))?.[1];

    // A null here means one of the two was RENAMED or REWRITTEN past what this
    // check can see — which must fail loudly rather than pass by finding
    // nothing on both sides. `undefined === undefined` would be a green tick
    // over a check that inspected nothing (AGENTS.md's "a check passing means
    // nothing on its own").
    check("the field's year pattern is findable", typeof declared, "string");
    check("the guard's year pattern is findable", typeof restated, "string");
    check("the Year field and the Save guard state the SAME pattern", restated, declared);

    if (declared) {
      const re = new RegExp(declared.slice(1, -1));
      const probes = [
        "", " ", "0", "1", "9", "26", "202", "999", "1000", "1999", "2026",
        "9999", "0000", "0202", "0999", "10000", "20266", "202666", "20AB",
        "2O26", "-202", "+2026", "2026.5", "2026 ", " 2026", "1e3",
      ];
      let drift = 0;
      for (const v of probes) {
        // Both sides tolerate empty by design — requiredness is a separate
        // question, and Year is optional — so blank must be quiet on both.
        const fieldSaysOk = v.trim() === "" || re.test(v.trim());
        const guardSaysOk = styleProblems({ style_year: v }).length === 0;
        if (fieldSaysOk !== guardSaysOk) {
          drift++;
          console.error(`      drift on "${v}": field=${fieldSaysOk} guard=${guardSaysOk}`);
        }
      }
      check("the field and the guard accept exactly the same values", drift, 0);
    }
  }
}

// ---------- THE PICKER AND THE RULE CANNOT DRIFT ----------
//
// The Components tab offers exactly `styleCoordinateIds`, and `orphanComponents`
// judges by exactly `styleCoordinateIds`. That is one function on purpose: two
// would drift into a picker offering a value the rule then rejects, or rejecting
// one it offered — and the drift is invisible until an operator hits it.
//
// Exhaustive over every coordinate the app could hold in this scenario, so the
// agreement is demonstrated rather than assumed.
{
  const declared = [coord(TOP), coord(BOTTOM), coord(null)];
  const offered = styleCoordinateIds(declared);
  const universe = [TOP, BOTTOM, SLEEVE_SET, "44444444-4444-4444-4444-444444444444"];

  let drift = 0;
  for (const id of universe) {
    const isOffered = offered.has(id);
    const isAccepted = orphanComponents([comp(id)], declared) === 0;
    if (isOffered !== isAccepted) {
      drift++;
      console.error(`      drift on ${id}: offered=${isOffered} accepted=${isAccepted}`);
    }
  }
  check("every offerable coordinate is accepted, and no other is", drift, 0);
}

// ---------------------------------------------------------------------------
// UNIT KIND, DERIVED FROM THE COORDINATE COUNT (2026-08-25).
//
// The Garment Order's Style is manual entry now, so the line's Order Unit can no
// longer be read off the master through `style_id`. `unitKindFromCoordinates`
// runs `COORDINATE_LIMITS` backwards instead, and that is only legitimate while
// the two ranges stay DISJOINT — the assertion below is the thing that notices
// the day someone widens one of them, because from that moment a count would
// satisfy both and the derivation would be picking a winner rather than reading
// a rule.
{
  check("0 coordinates says nothing", unitKindFromCoordinates(0), null);
  check("a negative count says nothing", unitKindFromCoordinates(-1), null);
  check("NaN says nothing", unitKindFromCoordinates(Number.NaN), null);
  check("1 coordinate is a Piece", unitKindFromCoordinates(1), "piece");
  check("2 coordinates is a Set", unitKindFromCoordinates(2), "set");
  check("6 coordinates is a Set", unitKindFromCoordinates(6), "set");
  // Above the client's ceiling it stays a Set. Seven coordinates is a Set the
  // grid should not have allowed, not a third kind of thing.
  check("7 coordinates is still a Set", unitKindFromCoordinates(7), "set");

  // ROUND TRIP: every count either kind ALLOWS must derive back to that kind.
  let mismatches = 0;
  for (const kind of ["piece", "set"] as const) {
    const { min, max } = COORDINATE_LIMITS[kind];
    for (let n = min; n <= max; n++) {
      if (unitKindFromCoordinates(n) !== kind) {
        mismatches++;
        console.error(`      ${n} coordinate(s) is ${kind}, derived ${unitKindFromCoordinates(n)}`);
      }
    }
  }
  check("every count a kind allows derives back to that kind", mismatches, 0);

  // DISJOINT, which is the precondition the whole derivation rests on.
  const overlap =
    COORDINATE_LIMITS.piece.max >= COORDINATE_LIMITS.set.min ||
    COORDINATE_LIMITS.piece.min > COORDINATE_LIMITS.piece.max;
  check("the two coordinate ranges do not overlap", overlap, false);

  // AND IT AGREES WITH `coordinateLimit`, the forward direction: a count derived
  // to a kind must sit inside that kind's own range. Two functions, one rule.
  let disagree = 0;
  for (let n = 1; n <= 6; n++) {
    const kind = unitKindFromCoordinates(n);
    const range = coordinateLimit(kind);
    if (!range || n < range.min || n > range.max) disagree++;
  }
  check("forward and backward agree over 1..6", disagree, 0);
}


// ---------------------------------------------------------------------------
// PCS AUTO-FILL (client 2026-08-29) — `impliedCoordinateId`,
// `coordinatesLocked`, and the argument they hand to `componentRowStarted`.
//
// These three are one rule read from three sides, and the whole feature is safe
// only while they agree: the screen pre-fills a coordinate, two enforcers then
// have to NOT read that pre-fill as the operator having started the row. If any
// one of them drifts, the failure is silent in a different way each time — a
// caged cursor, Enter stacking blank rows, or junk components saved forever.
//
// THERE WAS A FOURTH, `pieceCoordinateId`, AND ITS ABSENCE IS THE POINT. It
// found the master row whose code was "PIECES" so the Order Unit cell could seed
// it, and the client removed the idea outright — "no need to choose PIECES also,
// which is just one coordinate … whatever it is". Its vectors went with it
// rather than being kept green against a function nothing calls. What is
// asserted instead, below, is the property that replaced it: NO ASSERTION HERE
// MENTIONS A COORDINATE'S NAME OR CODE.
// ---------------------------------------------------------------------------
{
  const PIECES = "id-pieces";
  const TOP = "id-top";
  const BOTTOM = "id-bottom";
  // --- impliedCoordinateId: what a component row is pre-filled with ----------
  const one: CoordinateLike[] = [{ coordinate_id: PIECES }];
  const two: CoordinateLike[] = [{ coordinate_id: TOP }, { coordinate_id: BOTTOM }];
  const blank: CoordinateLike[] = [{ coordinate_id: null }];

  check("a PCS line with one coordinate implies it", impliedCoordinateId("piece", one), PIECES);
  // WHICHEVER IT IS. The pre-fill reads the line's own grid, not the master, so
  // a legacy PCS line carrying a hand-picked TOP fills with TOP.
  check(
    "a PCS line implies whatever its single coordinate is",
    impliedCoordinateId("piece", [{ coordinate_id: TOP }]),
    TOP,
  );
  check("a PCS line with no coordinate implies nothing", impliedCoordinateId("piece", blank), null);
  check(
    "a PCS line over its cap implies nothing — the operator must choose",
    impliedCoordinateId("piece", two),
    null,
  );
  check("a SET line implies nothing", impliedCoordinateId("set", one), null);
  // THE LOOP THAT MUST NOT CLOSE. `unitKindFromCoordinates` derives "piece" from
  // a count of one; if this read that derivation, a line would lock the very
  // grid the lock was derived from. An unanswered unit implies nothing.
  check("an unanswered unit implies nothing", impliedCoordinateId(null, one), null);
  check("blank rows are not counted", impliedCoordinateId("piece", [...one, ...blank]), PIECES);

  // --- coordinatesFull: when "+ Add coordinate" is hidden --------------------
  // Client 2026-08-29, screenshot 2545: "if I choose order unit as PCS, no need
  // to '+ Add coordinate' option — hide it, because it is only one for the
  // order unit PCS."
  //
  // DEMONSTRATED FAILING FIRST against the predicate that shipped the bug
  // (`filledCoordinates(rows) >= cap.max`): 4 of these fell, and the four are
  // the whole argument for the change — the reported PCS case, the seed
  // sequence that proves the empty line still opens, and the two SET cases
  // showing the fault was never only about PCS.
  const oneBlank: CoordinateLike[] = [{ coordinate_id: null }];

  // THE REPORTED BUG. The line the client was looking at: PCS, one blank row.
  // `filledCoordinates` read 0 here and the button showed.
  check("a PCS line on its seeded blank row is full", coordinatesFull("piece", oneBlank), true);
  check("a PCS line holding its coordinate is full", coordinatesFull("piece", one), true);
  check("a PCS line over its cap is full", coordinatesFull("piece", two), true);

  // NOT FULL AT ZERO, AND THIS ONE IS LOAD-BEARING RATHER THAN OBVIOUS.
  // `ChildGrid`'s seedRow effect declines to seed while `hideAdd` is true, so a
  // rule that answered true here would leave a PCS line with no row, no button
  // and no way in — the grid would be unreachable, not merely capped.
  check("an empty PCS line is NOT full — the seed must still fire", coordinatesFull("piece", []), false);
  check("an empty SET line is not full", coordinatesFull("set", []), false);

  // THE SEQUENCE THAT SETTLES. Written out because it is the argument that the
  // check above is safe, not merely non-empty: it must terminate at exactly one.
  {
    let rows: CoordinateLike[] = [];
    let seeds = 0;
    while (!coordinatesFull("piece", rows) && seeds < 5) {
      rows = [...rows, { coordinate_id: null }];
      seeds++;
    }
    check("a PCS line seeds exactly one row and then stops", seeds, 1);
  }

  // A SET FILLS AT SIX ROWS, counting the blank one it is sitting on — which is
  // the pre-existing bug this replaced: 5 filled + 1 blank read as 5, the button
  // showed at the cap, and `addStyleCoordinate`'s own "last row is blank" guard
  // declined the click anyway. A button that renders and does nothing.
  const fiveFilledPlusBlank: CoordinateLike[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ coordinate_id: `c${i}` })),
    { coordinate_id: null },
  ];
  check("a SET line with 5 filled and a blank is full", coordinatesFull("set", fiveFilledPlusBlank), true);
  check("a SET line with 5 rows is not", coordinatesFull("set", fiveFilledPlusBlank.slice(0, 5)), false);

  // AN UNANSWERED UNIT TAKES THE CEILING, never the Piece cap — capping it at
  // one would stop an operator entering a set before they reach the Order Unit
  // cell, and `coordinateCap` says so in as many words.
  check("an unanswered unit is not full at one row", coordinatesFull(null, one), false);
  check("an unanswered unit fills at six", coordinatesFull(null, fiveFilledPlusBlank), true);

  // --- coordinatesLocked: when the row's ✕ may be hidden ---------------------
  // IT NO LONGER GREYS THE PICKER (client 2026-08-29, "just release"). The
  // predicate is unchanged and so is every vector below it — what changed is
  // that the screen hangs one thing off it instead of two. Kept under the old
  // name for that reason: renaming would churn these assertions to say the same.
  check("a settled PCS line is locked", coordinatesLocked("piece", one), true);
  // UNLOCKED WHERE THERE IS STILL SOMETHING TO FIX. Locking either of these
  // would leave a line `styleProblems` refuses to save with no way to repair it.
  check("a PCS line with no coordinate is unlocked", coordinatesLocked("piece", blank), false);
  check("a PCS line over its cap is unlocked", coordinatesLocked("piece", two), false);
  check("a SET line is never locked", coordinatesLocked("set", two), false);
  check("an unanswered unit is never locked", coordinatesLocked(null, one), false);

  // A LOCKED GRID IS ALWAYS A SAVEABLE ONE. The lock and the save rule are
  // written independently, so this is the assertion that keeps them honest.
  let lockedButUnsaveable = 0;
  for (const kind of [null, "piece", "set"] as const) {
    for (const rows of [[], blank, one, two, [...two, { coordinate_id: PIECES }]]) {
      if (!coordinatesLocked(kind, rows)) continue;
      const problems = styleProblems({ unit_kind: kind, coordinates: rows, components: [] });
      if (problems.some((p) => p.section === "coordinates")) lockedButUnsaveable++;
    }
  }
  check("no locked grid is one the save would refuse", lockedButUnsaveable, 0);

  // --- THE RULE IS BLIND TO A COORDINATE'S NAME -----------------------------
  // The property that replaced `pieceCoordinateId` (client 2026-08-29: "no need
  // to choose PIECES also, which is just one coordinate … whatever it is").
  //
  // Asserted STRUCTURALLY rather than by one more TOP case: a single coordinate
  // whose id, code and name have nothing to do with "PIECES" — including one the
  // GAR master has never held — must drive the whole chain identically to the
  // PIECES row. If a name test is ever reintroduced anywhere in this rule, every
  // line below flips at once.
  //
  // DEMONSTRATED FAILING FIRST, by making `impliedCoordinateId` name-coupled
  // again (`ids[0].toUpperCase().includes("PIECES") ? ids[0] : null`). Seven
  // vectors fell, and WHICH seven is the useful part:
  //
  //  - the two rules that CALL it — implied and locked — failed on three of the
  //    four odd ids, plus the pre-existing "whatever its single coordinate is";
  //  - `componentRowStarted` and `orphanComponents` did NOT, because they take
  //    the implied id as an ARGUMENT rather than deriving it. That is the seam
  //    working as intended, and it is why the loop asserts all four rather than
  //    trusting the first two to speak for the rest.
  //  - **"id-pieces-not-really" survived the mutation**, which is the near miss
  //    a substring test always lets through and the reason an id that merely
  //    LOOKS like the old constant is in the list at all.
  for (const odd of ["id-sleeve-panel", "id-🙂", "id-", "id-pieces-not-really"]) {
    const solo: CoordinateLike[] = [{ coordinate_id: odd }];
    check(`a lone "${odd}" is implied like any other`, impliedCoordinateId("piece", solo), odd);
    check(`a lone "${odd}" settles the grid`, coordinatesLocked("piece", solo), true);
    check(
      `a row pre-filled with "${odd}" is not started`,
      componentRowStarted({ coordinate_id: odd }, odd),
      false,
    );
    // AND IT IS STILL AN ORPHAN WHEN IT DOES NOT BELONG. Name-blindness must not
    // become "any coordinate is fine" — the save rule is what keeps that honest.
    check(
      `"${odd}" is an orphan under a line that lists PIECES`,
      orphanComponents([{ coordinate_id: odd }], one),
      1,
    );
  }

  // --- componentRowStarted: the pre-fill is not a start ----------------------
  const prefilled = { coordinate_id: PIECES, component_id: null, fabric_category_id: null };
  check("a row holding only the pre-fill is not started", componentRowStarted(prefilled, PIECES), false);
  // AND EVERY OTHER COORDINATE STILL IS. Choosing TOP on a PCS line took a
  // decision — and it is the orphan `styleProblems` has to be able to see.
  check(
    "a row holding a DIFFERENT coordinate is started",
    componentRowStarted({ ...prefilled, coordinate_id: TOP }, PIECES),
    true,
  );
  check(
    "a pre-filled row that names a component is started",
    componentRowStarted({ ...prefilled, component_id: "c1" }, PIECES),
    true,
  );
  check(
    "a pre-filled row that names a structure is started",
    componentRowStarted({ ...prefilled, fabric_category_id: "f1" }, PIECES),
    true,
  );
  // BACKWARD COMPATIBLE. The Style master's grid has no auto-fill and passes
  // nothing; omitting the argument must answer exactly as it always did.
  check("with no implied coordinate a coordinate is still a start", componentRowStarted(prefilled), true);
  check(
    "an undefined implied coordinate reads as none",
    componentRowStarted(prefilled, undefined),
    true,
  );
  check("a truly blank row is never started", componentRowStarted({}, PIECES), false);
  check("a blank row with a null implied is never started", componentRowStarted({}, null), false);

  // THE POINT-FREE CALL SITE. `.filter(componentRowStarted)` hands the row INDEX
  // as the second argument — which `lib/orders/styles/actions.ts` did, and which
  // stopped compiling the moment the argument was added. It was wrapped there.
  //
  // THE BEHAVIOUR WOULD HAVE BEEN FINE, and saying so is the point of keeping
  // this: an index is a number and a coordinate id is a string, so
  // `r.coordinate_id !== 0` is true for every row that has one and the predicate
  // answers exactly as it did before. The compiler is the whole guard here, and
  // a reader who assumes a silent data bug would go looking for one that is not
  // there. Asserted rather than described, so it cannot rot into folklore.
  const rows = [{}, {}, {}];
  check(
    "a point-free filter still drops blank rows — the index is a compile error, not a data bug",
    // @ts-expect-error the shape that no longer type-checks, kept to prove it is harmless
    rows.filter(componentRowStarted).length,
    0,
  );
  check("a wrapped filter drops them all", rows.filter((r) => componentRowStarted(r)).length, 0);
  // AND A ROW THAT HOLDS A COORDINATE IS STARTED EITHER WAY, which is the half
  // that would actually have mattered had numbers and ids been comparable.
  check(
    "an index never masks a real coordinate",
    [{ coordinate_id: PIECES }].filter((r, i) =>
      componentRowStarted(r, i as unknown as string),
    ).length,
    1,
  );

  // THE PRE-FILLED ROW IS DROPPED BY THE SAVE, which is the third enforcer and
  // the one whose failure is permanent — a kept row reappears on every open.
  const saved = [prefilled, { ...prefilled, component_id: "c1" }].filter((r) =>
    componentRowStarted(r, PIECES),
  );
  check("the save keeps only the row the operator answered", saved.length, 1);

  // AND A PRE-FILLED ROW IS NOT AN ORPHAN. Its coordinate is the line's own, so
  // nothing here fires — which is exactly why `componentRowStarted` has to be
  // the thing that drops it.
  check(
    "a pre-filled row is not an orphan",
    orphanComponents([prefilled] as ComponentLike[], one),
    0,
  );
}

// ---------------------------------------------------------------------------
// THE STYLE LINE'S OWN COMPLETENESS (client 2026-08-31)
//
// These run on ONE ROW of the Garment Order's Style(s) tab. The load-bearing
// assertion is WHICH FIELD each problem names — the wording is allowed to
// change, but a problem naming the wrong cell sends the cursor to a field that
// is already filled, which is worse than no landing at all.
// ---------------------------------------------------------------------------
{
  const CAT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const FRONT = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const SLEEVE = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const SIZE_M = "55555555-5555-5555-5555-555555555555";

  const fields = (r: StyleLineLike) => styleLineProblems(r).map((p) => p.field);

  // A BLANK LINE IS NOT A BROKEN LINE. `ChildGrid` seeds one so Tab has a field
  // to land on, and a rule that flagged it would open every new order trapped —
  // the same argument `componentRowStarted` makes one level down.
  check("a blank line is not started", styleLineStarted({}), false);
  check(
    "a blank line with a blank component row is not started",
    styleLineStarted({ components: [{}], coordinates: [coord(null)], sizes: [] }),
    false,
  );
  check("a blank line has no problems", fields({}), []);

  // ONE TYPED CHARACTER STARTS IT, and then everything else is owed.
  check("a bare style ref starts the line", styleLineStarted({ style_ref_no: "RN-1" }), true);
  check(
    "a bare style ref owes the other five",
    fields({ style_ref_no: "RN-1" }),
    ["style_category", "order_unit", "description", "coordinates", "sizes"],
  );

  // STARTED FROM THE COMMERCIAL END COUNTS TOO. An operator who typed only a PO
  // Qty has begun a line, and a rule that could not see that would let exactly
  // the half-filled row the client is asking about through.
  check("a bare PO Qty starts the line", styleLineStarted({ po_qty: "500" }), true);
  check("a zero-length PO Qty does not", styleLineStarted({ po_qty: "" }), false);
  check("a bare article no starts the line", styleLineStarted({ article_no: "23" }), true);

  // A FINISHED PCS LINE IS SILENT.
  const done: StyleLineLike = {
    style_ref_no: "RN-1",
    style_category_id: CAT,
    unit_kind: "piece",
    description: "MENS TEE",
    coordinates: [coord(TOP)],
    sizes: [{ size_id: SIZE_M }],
    components: [{ coordinate_id: TOP, component_id: FRONT }],
  };
  check("a finished Pcs line has no problems", fields(done), []);

  // AND EACH FIELD FAILS ON ITS OWN, so a landing can never be aimed at a cell
  // that is already filled.
  check("a missing category names its own cell", fields({ ...done, style_category_id: null }), ["style_category"]);
  check("a missing unit names its own cell", fields({ ...done, unit_kind: null }), ["order_unit"]);
  check("a blank description names its own cell", fields({ ...done, description: "  " }), ["description"]);
  check("no size ticked names sizes", fields({ ...done, sizes: [] }), ["sizes"]);
  check("no coordinate names coordinates", fields({ ...done, coordinates: [], components: [] }), ["coordinates"]);

  // A HALF-FILLED COMPONENT ROW IS THE CLIENT'S "empty rows in downstream
  // reports", and the trailing blank one is not.
  // ISOLATED ON PURPOSE: the row names the line's OWN coordinate, so nothing
  // else fires. A structure with no component is started (`componentRowStarted`)
  // and unfinished, which is exactly the row that reaches a report as a blank.
  check(
    "a started component row with no component_id is half-filled",
    fields({
      ...done,
      components: [{ coordinate_id: TOP, component_id: null, fabric_category_id: "fab-a" }],
    }),
    ["components"],
  );
  // AND A ROW CAN BE WRONG TWICE. Filed under a coordinate the line does not
  // have AND missing its component: both fire, and both should — they are
  // different repairs. This vector exists because the first draft of the one
  // above accidentally tested this case and read the second message as a bug.
  check(
    "half-filled and orphaned are two problems, not one",
    fields({ ...done, components: [{ coordinate_id: BOTTOM, component_id: null }] }),
    ["components", "components"],
  );
  check(
    "a trailing blank component row is not a problem",
    fields({ ...done, components: [{ coordinate_id: TOP, component_id: FRONT }, {}] }),
    [],
  );
  // The PCS pre-fill is discounted: a row born holding the line's one coordinate
  // is not "started", so it is not "half-filled" either. Both readers discount
  // the SAME value, which is the whole reason `impliedCoordinateId` is computed
  // inside the rule rather than passed in.
  check(
    "a row holding only the Pcs pre-fill is not half-filled",
    fields({ ...done, components: [{ coordinate_id: TOP, component_id: FRONT }, { coordinate_id: TOP }] }),
    [],
  );

  // ---- NO COMPONENT TWICE UNDER ONE COORDINATE --------------------------
  check("one component once is not a duplicate", duplicateComponents([{ coordinate_id: TOP, component_id: FRONT }]), 0);
  check(
    "the same component twice under one coordinate is one duplicate",
    duplicateComponents([
      { coordinate_id: TOP, component_id: FRONT },
      { coordinate_id: TOP, component_id: FRONT },
    ]),
    1,
  );
  check(
    "three of them is two duplicates — the count is rows to fix, not rows involved",
    duplicateComponents([
      { coordinate_id: TOP, component_id: FRONT },
      { coordinate_id: TOP, component_id: FRONT },
      { coordinate_id: TOP, component_id: FRONT },
    ]),
    2,
  );
  // THE LOOSENING THAT MAKES A SET GARMENT ENTERABLE. A FRONT BODY on the TOP
  // and a FRONT BODY on the BOTTOM are two panels, two fabrics, one legitimate
  // style — the literal "filter it out of every later row" reading would make
  // that garment impossible to enter.
  check(
    "the same component under two coordinates is not a duplicate",
    duplicateComponents([
      { coordinate_id: TOP, component_id: FRONT },
      { coordinate_id: BOTTOM, component_id: FRONT },
    ]),
    0,
  );
  // STRICTER THAN THE DATABASE, DELIBERATELY. 0457's index also keys on
  // fabric_category, so it would accept this pair; the client chose the BOM
  // argument over the contrast yoke on 2026-08-31.
  check(
    "two fabrics of one component under one coordinate is still a duplicate",
    duplicateComponents([
      { coordinate_id: TOP, component_id: FRONT, fabric_category_id: "fab-a" },
      { coordinate_id: TOP, component_id: FRONT, fabric_category_id: "fab-b" },
    ]),
    1,
  );
  check(
    "an unanswered row is a duplicate of nothing",
    duplicateComponents([{ coordinate_id: TOP }, { coordinate_id: TOP }]),
    0,
  );
  check(
    "two unfiled rows naming one component do collide",
    duplicateComponents([{ component_id: FRONT }, { component_id: FRONT }]),
    1,
  );
  check(
    "a duplicate reaches the line as a components problem",
    fields({
      ...done,
      components: [
        { coordinate_id: TOP, component_id: FRONT },
        { coordinate_id: TOP, component_id: FRONT },
      ],
    }),
    ["components"],
  );

  // ---- WHAT THE DROPDOWN HIDES ------------------------------------------
  const taken = (siblings: Parameters<typeof componentsTakenUnder>[0], c: string | null) =>
    [...componentsTakenUnder(siblings, c)].sort();
  check(
    "a sibling under the same coordinate is hidden",
    taken([{ coordinate_id: TOP, component_id: FRONT }], TOP),
    [FRONT],
  );
  check(
    "a sibling under another coordinate is not",
    taken([{ coordinate_id: BOTTOM, component_id: FRONT }], TOP),
    [],
  );
  check(
    "an unfiled sibling is hidden only from other unfiled rows",
    taken([{ component_id: FRONT }], null),
    [FRONT],
  );
  check(
    "an unfiled sibling does not narrow a filed row",
    taken([{ component_id: FRONT }], TOP),
    [],
  );
  check(
    "only the answered siblings count",
    taken([{ coordinate_id: TOP }, { coordinate_id: TOP, component_id: SLEEVE }], TOP),
    [SLEEVE],
  );

  // ---- TWO LINES MAY NOT SHARE A STYLE REF ------------------------------
  // Keys arrive ALREADY NORMALISED — `styleKey` is the Orders join key and lives
  // in its own file precisely so there is one copy of it. These vectors are
  // therefore about COUNTING, not about casing.
  check("no repeats is empty", duplicateRefCounts(["A", "B", "C"]), []);
  check(
    "a repeat is reported with its count",
    duplicateRefCounts(["A", "B", "A"]),
    [{ ref: "A", count: 2 }],
  );
  check(
    "three of a kind counts three, not two",
    duplicateRefCounts(["A", "A", "A"]),
    [{ ref: "A", count: 3 }],
  );
  // BLANKS ARE NOT A COLLISION. `styleKey` returns "" for an unnamed row, and
  // two unnamed lines are two lines nobody has started.
  check("blank keys never collide", duplicateRefCounts(["", "", "A"]), []);
  check(
    "two separate repeats both reported, in first-seen order",
    duplicateRefCounts(["B", "A", "B", "A"]),
    [
      { ref: "B", count: 2 },
      { ref: "A", count: 2 },
    ],
  );
  check("an empty list is empty", duplicateRefCounts([]), []);
  // ---- THE MASTER IS GUARDED TOO ----------------------------------------
  // `garment_style_components` has NO unique index and `normalizeComponents`
  // de-dupes nothing, so `styleProblems` IS the whole guard there — and it
  // reaches the server through `garmentStyleInput`'s superRefine.
  check(
    "the master reports a repeated component",
    styleProblems({
      coordinates: [coord(TOP)],
      components: [
        { coordinate_id: TOP, component_id: FRONT },
        { coordinate_id: TOP, component_id: FRONT },
      ],
    }).map((p) => p.section),
    ["components"],
  );
  check(
    "the master allows one component under two coordinates",
    styleProblems({
      coordinates: [coord(TOP), coord(BOTTOM)],
      unit_kind: "set",
      components: [
        { coordinate_id: TOP, component_id: FRONT },
        { coordinate_id: BOTTOM, component_id: FRONT },
      ],
    }),
    [],
  );
  // A LEGACY STYLE IS NOT RETROACTIVELY INVALIDATED by anything else here, but
  // it IS by this — a style already holding a repeat cannot be saved again
  // until the repeat goes. That is the deliberate trade (no migration adds a
  // unique index, because nothing can decide which of a pair is the real one).
  check(
    "a duplicate fires even with no unit_kind",
    styleProblems({
      components: [
        { component_id: FRONT },
        { component_id: FRONT },
      ],
    }).map((p) => p.section),
    ["components"],
  );
  check(
    "the master and the order line word the duplicate identically",
    styleProblems({
      coordinates: [coord(TOP)],
      components: [
        { coordinate_id: TOP, component_id: FRONT },
        { coordinate_id: TOP, component_id: FRONT },
      ],
    })
      .filter((p) => p.section === "components")
      .map((p) => p.message),
    [
      duplicateComponentsMessage([
        { coordinate_id: TOP, component_id: FRONT },
        { coordinate_id: TOP, component_id: FRONT },
      ]),
    ],
  );
  // ---- ONE WORDING, TWO SCREENS -----------------------------------------
  // The point of extracting `coordinateCountMessage`: the Style master and the
  // order line must not say "exactly 1" and "at most 1" about one rule.
  const twoOnAPiece: StyleLineLike = { ...done, coordinates: [coord(TOP), coord(BOTTOM)] };
  check(
    "the master and the order line word the coordinate count identically",
    styleProblems({ unit_kind: "piece", coordinates: [coord(TOP), coord(BOTTOM)] })
      .filter((p) => p.section === "coordinates")
      .map((p) => p.message),
    styleLineProblems(twoOnAPiece)
      .filter((p) => p.field === "coordinates")
      .map((p) => p.message),
  );
  check(
    "an unanswered unit has no range to be outside of",
    coordinateCountMessage(null, [coord(TOP), coord(BOTTOM)]),
    null,
  );
  check(
    "a Set line with one coordinate is short",
    coordinateCountMessage("set", [coord(TOP)]) !== null,
    true,
  );
  // AND THE ORPHAN WORDING TOO.
  check(
    "the master and the order line word the orphan count identically",
    styleProblems({ coordinates: [coord(TOP)], components: [comp(SLEEVE_SET)] })
      .filter((p) => p.section === "components")
      .map((p) => p.message),
    [orphanComponentsMessage([comp(SLEEVE_SET)], [coord(TOP)])],
  );
}

console.log(
  failed === 0 ? "\nAll style-rule vectors passed." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
