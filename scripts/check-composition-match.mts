/**
 * Vectors for `compositionForStructure()` in `lib/orders/amendments/combo-rules.ts`
 * — the rule that fetches a Garment Order structure's Composition from the fabric
 * behind it (0434).
 *
 * ## WHY THIS RULE IS VECTORED AND `gsmRange` BESIDE IT IS NOT
 *
 * Every other rule in that file is a FUNCTION OF WHAT IS ON SCREEN: a wrong
 * answer is visible in the cell that produced it. This one reaches across three
 * tables to fill in a field the operator did not touch, and it fills it in with a
 * value that reads as authoritative — the composition of the cloth, which is what
 * the buyer approved and what the fabric is costed against. A wrong auto-fill here
 * is not a visibly wrong number; it is a plausible one.
 *
 * So the interesting assertions are not the matches. They are the ABSTENTIONS:
 * every branch below names a live row it exists for, and each one is a case where
 * a looser implementation would have produced a confident wrong answer instead of
 * a blank cell the operator fills in.
 *
 * ## THE TWO THAT WOULD SURVIVE A CARELESS REWRITE
 *
 * 1. **A composition line with no category is UNMATCHABLE, not a wildcard.** Rows
 *    predating 0384 carry only text, and the live `Test Composition` is one. The
 *    tempting implementation keys the line on `String(category_id)` — at which
 *    point `"null"` is a perfectly good key, two categoryless lines agree with each
 *    other, and the rule matches a record that states nothing. §3.
 *
 * 2. **A missing percentage means 100 for ONE line and NOTHING for two.** A
 *    single-component fabric stores no share because there is nothing to share
 *    with; a two-component fabric that stores no shares has a split nobody has
 *    entered. Treating the second like the first invents 50/50 — a figure the
 *    master never stated. `YARN DYED SINGLE JERSEY (10'S COMBED COTTON, 10'S GREY
 *    MELANGE)` is exactly that row today. §2.
 *
 * Run: `npm run check:composition-match`.
 */
import {
  blendOf,
  blendOfComposition,
  compositionForStructure,
  type CompositionBlend,
  type FabricBlend,
} from "../lib/orders/amendments/combo-rules.ts";

let failed = 0;

function check(what: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok    ${what}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${what}\n      expected ${e}\n      actual   ${a}`);
  }
}

// Category ids, named for what they are so a failure reads in trade terms.
const COTTON = "cat-cotton";
const ELASTANE = "cat-elastane";
const POLYESTER = "cat-polyester";
const MELANGE = "cat-grey-melange";

// Structures (fabric categories).
const RIB = "str-1x1-lycra-rib";
const FLEECE = "str-fleece";
const JERSEY = "str-single-jersey";
const PIQUE = "str-pique";
const EMPTY_STRUCT = "str-nothing-under-it";

const fabric = (id: string, category_id: string, mixing: FabricBlend["mixing"]): FabricBlend => ({
  id,
  category_id,
  mixing,
});
const share = (category_id: string | null, pct: number | null) => ({ category_id, pct });

const comp = (
  id: string,
  lines: { category_id: string | null; mixing_pct: number }[],
  inactive = false,
): CompositionBlend => ({ id, inactive, lines });

// ---------------------------------------------------------------------------
// 1. The blend reduction itself
// ---------------------------------------------------------------------------

check(
  "two shares reduce to two categories",
  [...(blendOf([share(COTTON, 95), share(ELASTANE, 5)]) ?? new Map())],
  [
    [COTTON, 95],
    [ELASTANE, 5],
  ],
);

// SOLID FLEECE names cotton twice — two different yarn ITEMS, one fibre. As a
// composition that fabric is COTTON 90 / POLYESTER 10, and the summing is what
// makes the two sides comparable at all.
check(
  "the same fibre on two lines sums to one share",
  [...(blendOf([share(COTTON, 55), share(COTTON, 35), share(POLYESTER, 10)]) ?? new Map())],
  [
    [COTTON, 90],
    [POLYESTER, 10],
  ],
);

check("an empty mixing is unreadable, not empty", blendOf([]), null);
check("a yarn with no category makes the whole blend unreadable", blendOf([share(null, 100)]), null);

// ---------------------------------------------------------------------------
// 2. The percentage rules — §2 of the header
// ---------------------------------------------------------------------------

check(
  "one line with no share IS the whole cloth",
  [...(blendOf([share(COTTON, null)]) ?? new Map())],
  [[COTTON, 100]],
);

// THE ONE THAT MATTERS. An even split is the obvious thing to do here and it is
// forbidden: nobody has stated it.
check(
  "two lines with no shares are unreadable, never 50/50",
  blendOf([share(COTTON, null), share(MELANGE, null)]),
  null,
);
check(
  "…and one share missing out of two is unreadable too",
  blendOf([share(COTTON, 95), share(ELASTANE, null)]),
  null,
);

// ---------------------------------------------------------------------------
// 3. The master's side — §1 of the header
// ---------------------------------------------------------------------------

check(
  "a categoryless composition line makes its composition unmatchable",
  blendOfComposition(comp("cmp-legacy", [{ category_id: null, mixing_pct: 100 }])),
  null,
);

// THE WILDCARD TRAP IS ONLY OBSERVABLE ON THE HELPER, and that is worth stating
// rather than padding the suite with a vector that cannot fail. Going through
// `compositionForStructure` cannot expose it: the fabric side of the comparison
// is keyed on real category ids, so a `"null"` key never equals one and the rule
// returns null either way. A through-the-rule vector for it would pass against
// the broken implementation too — asserted by breaking it, which failed the check
// above and NOT that one.
//
// What IS reachable, and is the live case: `Test Composition` sits in the master
// today with a categoryless line. It must neither throw nor count as a second
// match — a rule that treated it as matching anything would see two answers here
// and abstain, silently withholding a correct fetch.
check(
  "a categoryless row in the master neither breaks nor blocks a real match",
  compositionForStructure(
    RIB,
    [fabric("fab-rib", RIB, [share(COTTON, 95), share(ELASTANE, 5)])],
    [
      comp("cmp-legacy", [{ category_id: null, mixing_pct: 100 }]),
      comp("cmp-co95-el5", [
        { category_id: COTTON, mixing_pct: 95 },
        { category_id: ELASTANE, mixing_pct: 5 },
      ]),
    ],
  ),
  "cmp-co95-el5",
);

// ---------------------------------------------------------------------------
// 4. The rule end to end — what actually fills the cell
// ---------------------------------------------------------------------------

const RIB_FABRIC = fabric("fab-rib", RIB, [share(COTTON, 95), share(ELASTANE, 5)]);
const FLEECE_FABRIC = fabric("fab-fleece", FLEECE, [
  share(COTTON, 55),
  share(COTTON, 35),
  share(POLYESTER, 10),
]);
const PIQUE_FABRIC = fabric("fab-pique", PIQUE, [share(COTTON, null)]);
const JERSEY_A = fabric("fab-sj-a", JERSEY, [share(COTTON, 95), share(ELASTANE, 5)]);
const JERSEY_B = fabric("fab-sj-b", JERSEY, [share(COTTON, null)]);
const FABRICS = [RIB_FABRIC, FLEECE_FABRIC, PIQUE_FABRIC, JERSEY_A, JERSEY_B];

const C_COTTON_ELASTANE = comp("cmp-co95-el5", [
  { category_id: COTTON, mixing_pct: 95 },
  { category_id: ELASTANE, mixing_pct: 5 },
]);
const C_COTTON_POLY = comp("cmp-co90-po10", [
  { category_id: COTTON, mixing_pct: 90 },
  { category_id: POLYESTER, mixing_pct: 10 },
]);
const C_COTTON_100 = comp("cmp-co100", [{ category_id: COTTON, mixing_pct: 100 }]);
const MASTER = [C_COTTON_ELASTANE, C_COTTON_POLY, C_COTTON_100];

check(
  "a structure with one fabric fetches the composition stating its blend",
  compositionForStructure(RIB, FABRICS, MASTER),
  "cmp-co95-el5",
);
check(
  "the summed blend is what matches, not the raw lines",
  compositionForStructure(FLEECE, FABRICS, MASTER),
  "cmp-co90-po10",
);
check(
  "a single-yarn fabric fetches the 100% composition",
  compositionForStructure(PIQUE, FABRICS, MASTER),
  "cmp-co100",
);

// ---------------------------------------------------------------------------
// 5. The abstentions — every one names a real state
// ---------------------------------------------------------------------------

check("no structure, no answer", compositionForStructure(null, FABRICS, MASTER), null);
check(
  "a structure holding several fabrics abstains (SINGLE JERSEY holds ten)",
  compositionForStructure(JERSEY, FABRICS, MASTER),
  null,
);
check(
  "a structure holding no fabric abstains",
  compositionForStructure(EMPTY_STRUCT, FABRICS, MASTER),
  null,
);
check(
  "a blend no composition states leaves the cell blank",
  compositionForStructure(RIB, FABRICS, [C_COTTON_100]),
  null,
);

// A switched-off master row is about to be hidden by the picker, so filling the
// cell with it would produce a value the operator can see and cannot re-pick.
check(
  "an inactive composition is never auto-filled",
  compositionForStructure(RIB, FABRICS, [
    comp(
      "cmp-off",
      [
        { category_id: COTTON, mixing_pct: 95 },
        { category_id: ELASTANE, mixing_pct: 5 },
      ],
      true,
    ),
  ]),
  null,
);

// Two right answers is no answer: filling one in would be a coin toss the
// operator has no way to see was tossed.
check(
  "two compositions stating the same blend abstain",
  compositionForStructure(RIB, FABRICS, [
    C_COTTON_ELASTANE,
    comp("cmp-twin", [
      { category_id: COTTON, mixing_pct: 95 },
      { category_id: ELASTANE, mixing_pct: 5 },
    ]),
  ]),
  null,
);

// ---------------------------------------------------------------------------
// 6. STRICT, and this is where a tolerance band would show
// ---------------------------------------------------------------------------

check(
  "95/5 does not match 90/10",
  compositionForStructure(RIB, FABRICS, [C_COTTON_POLY, C_COTTON_100]),
  null,
);
check(
  "a subset is not a match — an extra fibre is a different cloth",
  compositionForStructure(PIQUE, FABRICS, [
    comp("cmp-co100-el0", [
      { category_id: COTTON, mixing_pct: 100 },
      { category_id: ELASTANE, mixing_pct: 0 },
    ]),
  ]),
  null,
);
// Both columns are numeric(6,2), so this is equality, not a tolerance: 95 and
// 95.00 are the same stored number written two ways.
check(
  "95.00 and 95 are the same share",
  compositionForStructure(RIB, FABRICS, [
    comp("cmp-2dp", [
      { category_id: COTTON, mixing_pct: 95.0 },
      { category_id: ELASTANE, mixing_pct: 5.0 },
    ]),
  ]),
  "cmp-2dp",
);

console.log(
  failed === 0
    ? "\nOK — every composition-match vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
