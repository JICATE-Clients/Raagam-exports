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
  filledCoordinates,
  unitKindFromCoordinates,
  orphanComponents,
  styleCoordinateIds,
  styleProblems,
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

console.log(
  failed === 0 ? "\nAll style-rule vectors passed." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
