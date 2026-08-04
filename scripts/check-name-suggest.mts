// Verification vectors for the "did you mean?" strip — the matcher
// (lib/masters/name-dictionary.ts), the class-keyed vocabulary
// (lib/masters/name-vocabularies.ts) and the free/taken split that
// lib/masters/use-spell-suggest.ts performs on their output.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-name-suggest.mts
//
// Exits non-zero on the first mismatch so it can gate a commit if wanted. Listed
// in tsconfig `exclude` alongside check-gstin.mts for the same reason: node's
// type stripping needs the `.ts` extension on these imports and the app's
// tsconfig forbids it, so the file is verified by running it, not by tsc.
//
// The rows below are the REAL contents of the categories table on 2026-08-04,
// including the INTARLOCK / INTERLOCK twin — the case the whole warning half
// exists for, and one no invented fixture would have thought to include.

import {
  MAX_CHIPS,
  normName as norm,
  splitSuggestions,
  suggestEntityNames,
} from "../lib/masters/name-dictionary.ts";
import { categoryNameSeed } from "../lib/masters/name-vocabularies.ts";

const ROWS: Record<string, string[]> = {
  YARN: ["COTTON", "ELASTANE", "LINEN", "POLYCOTTON", "POLYESTER", "VISCOSE"],
  FABRIC: ["1X1 LYCRA RIB", "COLLAR", "FLEECE", "INTARLOCK", "INTERLOCK", "ROPE", "SINGLE JERSEY"],
  PACK: ["POLY BAG", "TAGS"],
  SEW: ["BUTTON", "ELASTIC", "LABEL", "ROPE", "SEWING THREAD", "STRING", "TAPE"],
  GEN: ["ELECTRICAL ITEMS"],
  CAP: ["MACHINERY ITEMS"],
  GAR: ["TEST"],
};

/**
 * What the Category screen hands the hook, run through the hook's OWN splitter.
 * Not a replica of it — `splitSuggestions` is the same function the strip calls,
 * so the caps and the filter cannot drift out from under this file.
 */
function strip(classCode: string, typed: string) {
  const names = ROWS[classCode] ?? [];
  const { suggestions, existing } = splitSuggestions(
    typed,
    [...categoryNameSeed(classCode), ...names],
    new Set(names.map(norm)),
  );
  return { chips: suggestions, existing };
}

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}\n        ${detail}`);
  }
}

console.log("\nthe invariant — a chip is always saveable");
for (const [cls, names] of Object.entries(ROWS)) {
  const taken = new Set(names.map(norm));
  // Every prefix of every existing name is the worst case: it is exactly what an
  // operator types on their way to re-entering a name that is already there.
  const typed = names.flatMap((n) => [n, n.slice(0, 3), n.slice(0, 5)]).filter((s) => s.length >= 3);
  const bad = typed.flatMap((t) => strip(cls, t).chips.filter((c) => taken.has(c)));
  check(`${cls}: no chip is an existing row`, bad.length === 0, `offered taken name(s): ${bad.join(", ")}`);
}

console.log("\nthe complaint (client 2026-08-04) — COT under YARN");
{
  const { chips, existing } = strip("YARN", "COT");
  check("COTTON is not offered as a chip", !chips.includes("COTTON"), `chips: ${chips.join(", ")}`);
  check("POLYCOTTON is not offered as a chip", !chips.includes("POLYCOTTON"), `chips: ${chips.join(", ")}`);
  check("but they are still named", existing.length > 0, `existing was empty`);
  console.log(`        chips=[${chips.join(", ")}]  existing=[${existing.join(", ")}]`);
}

console.log("\nthe headline — COTTON exists, offer the next free one containing it");
{
  const { chips } = strip("YARN", "COTTON");
  check("there is something free to offer", chips.length > 0, "no chips at all");
  check(
    "every chip still contains COTTON",
    chips.every((c) => c.includes("COTTON")),
    `chips: ${chips.join(", ")}`,
  );
  // The vocabulary has to be deep enough to actually FILL the strip — a cap of
  // five that only ever produces two is the "limited suggestion" complaint again.
  check(`the strip is full (${chips.length}/${MAX_CHIPS})`, chips.length === MAX_CHIPS,
    `only ${chips.length}: ${chips.join(", ")}`);
  console.log(`        chips=[${chips.join(", ")}]`);
}

console.log("\nthe twin — INTARLOCK beside the existing INTERLOCK");
{
  const { existing } = strip("FABRIC", "INTARLOCK");
  check("INTERLOCK is named", existing.includes("INTERLOCK"), `existing: ${existing.join(", ")}`);
}

console.log("\nTHE BOUNDARY — a class may only ever be offered its OWN words");
{
  // The rule stated as a property rather than as a handful of examples: for any
  // text an operator can type, every name the strip returns must belong to the
  // selected item class — its vocabulary, or a category of that class that
  // already exists. Nothing from a sibling class, nothing from anywhere else.
  //
  // Probed with every prefix of every word the WHOLE system knows, which is the
  // adversarial input: it is exactly what the field passes through while someone
  // types a name that belongs to a different class.
  const classes = Object.keys(ROWS);
  const everyWord = [
    ...new Set(classes.flatMap((c) => [...categoryNameSeed(c), ...(ROWS[c] ?? [])])),
  ];
  const probes = [
    ...new Set(
      everyWord.flatMap((w) => [w, ...[3, 4, 5, 6, 8].map((n) => w.slice(0, n))]),
    ),
  ].filter((p) => p.trim().length >= 3);

  for (const cls of classes) {
    const own = new Set([...categoryNameSeed(cls), ...(ROWS[cls] ?? [])].map(norm));
    const outside = new Set<string>();
    for (const p of probes) {
      const { chips, existing } = strip(cls, p);
      for (const n of [...chips, ...existing]) if (!own.has(n)) outside.add(n);
    }
    check(
      `${cls}: nothing from outside its own words (${probes.length} probes)`,
      outside.size === 0,
      `leaked: ${[...outside].slice(0, 8).join(", ")}`,
    );
  }
}

console.log("\nthe 2026-07-28 regression — a fibre word must reach ONLY yarn");
{
  // The 07-28 bug in one assertion: a fibre vocabulary reachable from a screen
  // that never asked for one. Now that all seven classes carry a list, "the
  // other classes have no list" no longer proves anything — so test the property
  // that actually matters, which is that the fibre words are not IN them.
  const fibres = ["COTTON", "VISCOSE", "POLYESTER", "MODAL", "SILK", "POLYCOTTON"];
  for (const cls of ["FABRIC", "SEW", "PACK", "GAR", "GEN", "CAP"]) {
    const leaked = fibres.flatMap((f) => [...strip(cls, f).chips, ...strip(cls, f).existing])
      .filter((n) => fibres.includes(n));
    check(`${cls}: no fibre word reachable`, leaked.length === 0, `leaked: ${leaked.join(", ")}`);
  }
  check("YARN can reach them", strip("YARN", "COTTON").chips.length > 0, "yarn offered nothing");
}

console.log("\nall seven classes carry a vocabulary (client 2026-08-04)");
{
  for (const cls of ["YARN", "FABRIC", "SEW", "PACK", "GAR", "GEN", "CAP"]) {
    const n = categoryNameSeed(cls).length;
    check(`${cls} has one (${n} names)`, n > 0, "empty");
  }
  // The safety property survives the expansion: [] now means "a class this build
  // has never heard of", which is exactly when guessing would be worst.
  check("categoryNameSeed(null) is empty", categoryNameSeed(null).length === 0, "returned a list");
  check("categoryNameSeed(unknown) is empty", categoryNameSeed("NOPE").length === 0, "returned a list");
  check("lower case still resolves", categoryNameSeed("yarn").length > 0, "case-sensitive");
}

console.log("\nthe lists are maintainable — sorted, unique, CAPS, no misspellings smuggled in");
{
  for (const cls of ["YARN", "FABRIC", "SEW", "PACK", "GAR", "GEN", "CAP"]) {
    const v = categoryNameSeed(cls);
    check(`${cls} is sorted`, JSON.stringify(v) === JSON.stringify([...v].sort()), "out of order");
    check(`${cls} is unique`, new Set(v).size === v.length, "has duplicates");
    check(`${cls} is CAPS/trimmed`, v.every((n) => n === norm(n)), "a name is not normalised");
  }
  // The twin must never be IN a list — the list is meant to be the dictionary.
  check(
    "INTARLOCK is not in the FABRIC vocabulary",
    !categoryNameSeed("FABRIC").includes("INTARLOCK"),
    "the misspelling was listed as an alternative",
  );
}

console.log("\nthe seeded masters are unharmed — a free name is still offered");
{
  // Country master shape: a vocabulary, and a rows list that does not contain it.
  const pool = suggestEntityNames("GERM", ["GERMANY", "FRANCE"], 12);
  check("GERM still offers GERMANY", pool.includes("GERMANY"), `pool: ${pool.join(", ")}`);
}

console.log(failures === 0 ? "\nall good\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
