// Verification vectors for lib/masters/size-order.ts.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-size-order.mts
//     npm run check:size-order
//
// ## THIS CHECK WAS MADE TO FAIL BEFORE IT WAS TRUSTED
//
// A check that prints `ok` against the code it was written beside proves only
// that the two agree — not that it would notice if the code were wrong. So it
// carries the OLD behaviour as a switch:
//
//     node --experimental-strip-types scripts/check-size-order.mts --baseline
//
// which sorts with `localeCompare`, exactly as every size list in the app did
// before this commit. Every ordering vector below must FAIL under `--baseline`
// and pass without it. If a vector passes both ways it is asserting nothing, and
// the run says so rather than counting it as a pass.
//
// That matters here more than usual: alphabetical order is not obviously broken
// to a reader — `L, M, S, XL, XS` looks sorted, because it is. It is sorted by
// the wrong key. A vector that cannot tell those apart is the kind that reports
// `0 findings` forever.

import {
  groupBySizeFamily,
  naturalSizeOrder,
  sizeFamily,
  sortBySize,
} from "../lib/masters/size-order.ts";

const BASELINE = process.argv.includes("--baseline");

/** What the app did before: plain alphabetical, the source of screenshot 2392. */
const compare = BASELINE
  ? (a: string, b: string) => a.localeCompare(b)
  : naturalSizeOrder;

let failed = 0;
let vacuous = 0;

function order(label: string, input: string[], expected: string[]) {
  const actual = [...input].sort(compare);
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  if (BASELINE) {
    // Under --baseline a PASS is the failure: it means the vector cannot
    // distinguish the fix from the bug.
    if (ok) {
      vacuous++;
      console.error(`VACUOUS  ${label}\n         passes under --baseline, so it asserts nothing`);
    } else {
      console.log(`caught   ${label}`);
    }
    return;
  }

  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

/** For assertions that are about totality rather than order — run either way. */
function check(label: string, actual: unknown, expected: unknown) {
  if (BASELINE) return;
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

// ---------------------------------------------------------------- the report
// The exact list in client screenshot 2392, in the exact order it was shown.
// This is the vector the whole file exists for.
order(
  "screenshot 2392 — the live Sizes master",
  ["L", "M", "S", "TEST", "XL", "XS", "XXL", "XXS"],
  ["XXS", "XS", "S", "M", "L", "XL", "XXL", "TEST"],
);

// ---------------------------------------------------------------- the ladder
order(
  "letter ladder, shuffled",
  ["XL", "S", "3XL", "XXS", "M", "XXL", "L", "XS", "4XL"],
  ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"],
);

// XXXL and 3XL are the same size and both are in the database today. They must
// land next to each other so the duplication is visible to whoever tidies the
// master — not a dozen rows apart.
order(
  "aliases of one size sort adjacent",
  ["XXXL", "XL", "3XL", "L"],
  ["L", "XL", "3XL", "XXXL"],
);

order(
  "long-form spellings rank with their letters",
  ["LARGE", "SMALL", "MEDIUM"],
  ["SMALL", "MEDIUM", "LARGE"],
);

// ---------------------------------------------------------------- numbers
order(
  "bare numbers sort numerically, not as text",
  ["10", "2", "20", "4", "12", "6"],
  ["2", "4", "6", "10", "12", "20"],
);

// The single-digit N9 is what makes this vector discriminate: alphabetically it
// sorts AFTER N16, because "9" > "1" one character in. Every vector here needs a
// digit-count change somewhere for exactly that reason — a family whose members
// are all two digits sorts identically both ways, which is how five vectors in
// the first draft of this file turned out to assert nothing.
order(
  "fractions fold into the number line",
  ["N15", "N14½", "N16", "N9", "N14", "N15½"],
  ["N9", "N14", "N14½", "N15", "N15½", "N16"],
);

// ---------------------------------------------------------------- families
order(
  "a prefixed family sorts by magnitude inside itself",
  ["W34", "W8", "W126", "W26", "W48", "W30"],
  ["W8", "W26", "W30", "W34", "W48", "W126"],
);

// Family before magnitude. A list holding both W38 and EU38 is exactly the list
// where seeing which family a number belongs to is the point.
order(
  "families stay together rather than interleaving by number",
  ["EU38", "W34", "EU8", "W8", "EU34", "W38"],
  ["EU8", "EU34", "EU38", "W8", "W34", "W38"],
);

order(
  "kids ages: months before years, each numerically",
  ["2Y", "12-18M", "10Y", "0-3M", "8Y", "3-6M"],
  ["0-3M", "3-6M", "12-18M", "2Y", "8Y", "10Y"],
);

// A range sorts on its LOWER bound. Upper-bound sorting gives the same answer on
// a clean ladder and a wrong one the moment two ranges overlap.
order(
  "a range sorts on its lower bound",
  ["12-18M", "0-3M", "6-9M", "3-6M"],
  ["0-3M", "3-6M", "6-9M", "12-18M"],
);

// A bare number is its own band — it must not interleave with a family.
order(
  "bare numbers do not mix into a prefixed family",
  ["W30", "8", "W8", "30"],
  ["8", "30", "W8", "W30"],
);

// ---------------------------------------------------------------- the strays
order(
  "one-size labels sort last, below every real size",
  ["FREE SIZE", "M", "OS", "XL"],
  ["M", "XL", "FREE SIZE", "OS"],
);

order(
  "unparseable labels sit together, alphabetically, above one-size",
  ["XSP", "M", "S/T", "FREE SIZE", "L"],
  ["M", "L", "S/T", "XSP", "FREE SIZE"],
);

// ---------------------------------------------------------------- totality
// The comparator runs at keydown over a list nobody validated. It must be total
// and stable: no input can make it throw, and the answer cannot depend on the
// order the rows arrived in.
//
// ONE BLANK, NOT TWO — and that is a correction this check earned.
//
// The first draft had both `""` and `"   "` in here and demanded a fixed order
// between them. It failed, and the comparator was right: the two normalise to
// the same string, so they ARE equal, and 0 is the honest answer. Forcing a
// tiebreak on the raw text would have invented an order between two values
// nothing can tell apart — which is worse than the flake it was hiding, because
// it would then depend on trailing whitespace nobody can see.
//
// A blank size cannot reach the master anyway (`name` is required), so one is
// here to prove nothing throws, not to be ranked.
const MESSY = ["", "M", "xl", " s ", "TEST", "3XL", "0-3M", "W32", "½"];

const once = [...MESSY].sort(naturalSizeOrder);
const twice = [...MESSY].reverse().sort(naturalSizeOrder);
check("order does not depend on input order", once, twice);

check(
  "lower case and stray whitespace rank with their real size",
  ["xl", " s ", "M"].sort(naturalSizeOrder),
  [" s ", "M", "xl"],
);

check("comparator is reflexive", naturalSizeOrder("M", "M"), 0);
check("comparator is antisymmetric", Math.sign(naturalSizeOrder("S", "M")), -Math.sign(naturalSizeOrder("M", "S")));

// `sortBySize` is what the screens actually call; it must not mutate its input.
const rows = [{ name: "XL" }, { name: "S" }, { name: "M" }];
const sorted = sortBySize(rows, (r) => r.name);
check("sortBySize returns the right order", sorted.map((r) => r.name), ["S", "M", "XL"]);
check("sortBySize does not mutate its input", rows.map((r) => r.name), ["XL", "S", "M"]);

// ---------------------------------------------------------------- families
// The band an operator reads. `M` vs `3M` is the vector that matters: they are
// Medium and three months, and in a flat list nothing tells them apart.
check("a bare M is the letter ladder", sizeFamily("M").label, "Letter");
check("3M is months", sizeFamily("3M").label, "Months");
check("a month RANGE is months too", sizeFamily("0-3M").label, "Months");
check("2Y is years", sizeFamily("2Y").label, "Years");
check("a bare number is its own family", sizeFamily("32").label, "Numeric");
check("one-size is its own family", sizeFamily("FREE SIZE").label, "Free size");
check("an unparseable name lands in Other", sizeFamily("S/T").label, "Other");

// Only Y and M were named by the client. Everything else is shown VERBATIM
// rather than given an invented English name — `W` is not labelled "Waist",
// because nobody said it meant waist.
check("an un-named prefix labels itself", sizeFamily("W32").label, "W");
check("prefix families are distinct", sizeFamily("EU38").key === sizeFamily("W38").key, false);

// Spelling variants are ONE family and sort adjacent. `2Y` and `2YR` will both
// get typed into a hand-maintained master; the list must not pretend they are
// unrelated sizes.
check("YR folds to Y", sizeFamily("2YR").label, "Years");
check("MONTHS folds to M", sizeFamily("3MONTHS").label, "Months");
// `10Y` is what makes this discriminate — alphabetically it leads, because "1"
// sorts before "2". Without it the whole vector is alphabetical by accident and
// `--baseline` says so.
order(
  "spelling variants of one size sort adjacent",
  ["3Y", "2YR", "10Y", "2Y"],
  ["2Y", "2YR", "3Y", "10Y"],
);

// Band ORDER comes from the sort, not from a second hand-written list — so the
// two cannot drift.
check(
  "families come out in the order their first member sorts",
  groupBySizeFamily(["14Y", "M", "0-3M", "32", "XS", "FREE SIZE", "W30"], (s) => s)
    .map((g) => g.family.label),
  ["Letter", "Numeric", "Months", "Years", "W", "Free size"],
);

check(
  "each family keeps its own natural order",
  groupBySizeFamily(["10Y", "2Y", "14Y"], (s) => s)[0]?.rows,
  ["2Y", "10Y", "14Y"],
);

check(
  "grouping is exhaustive — nothing is dropped",
  groupBySizeFamily(["M", "3M", "W32", "??", "OS"], (s) => s)
    .reduce((n, g) => n + g.rows.length, 0),
  5,
);

// ---------------------------------------------------------------- verdict
if (BASELINE) {
  if (vacuous > 0) {
    console.error(`\n${vacuous} vector(s) assert nothing — they pass with the OLD alphabetical sort.`);
    process.exit(1);
  }
  console.log("\nEvery ordering vector fails under --baseline, so each one is load-bearing.");
  process.exit(0);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll size-order checks passed.");
