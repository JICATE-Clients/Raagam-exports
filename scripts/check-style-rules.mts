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
// The screen itself cannot be exercised here: migration 0392 adds the columns
// these rules read (`unit_kind`) and is not applied, so /orders/styles does not
// load. `rules.ts` imports nothing, which is what lets it be proved anyway.
//
// Exits non-zero on the first mismatch so it can gate a commit if wanted.

import {
  coordinateLimit,
  filledCoordinates,
  orphanComponents,
  styleCoordinateIds,
  styleProblems,
  type CoordinateLike,
  type ComponentLike,
} from "../lib/orders/styles/rules.ts";

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

console.log(
  failed === 0 ? "\nAll style-rule vectors passed." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
