/**
 * Vectors for `lib/orders/fabric-bom/yarn-process.ts` — Fabric BOM ▸ Yarn
 * Process, the tab that turns a fabric requirement into a YARN PURCHASE.
 *
 * Its output is the largest single quantity in a knitted order and it feeds the
 * Budget directly, so the failure modes here are money rather than pixels. Five
 * are pinned deliberately, and every one of them is a plausible implementation
 * that looks completely normal on screen.
 *
 * ## 1. THE BLEND SHARE IS NOT OPTIONAL
 *
 * A fabric has several yarns. Charging each of them the WHOLE fabric weight is
 * the obvious first cut — every row carries a believable figure — while buying
 * 200% of a two-yarn fabric and 300% of a three-yarn one. Section 2.
 *
 * ## 2. AN UNDECLARED BLEND MUST REFUSE, NOT SPLIT EQUALLY
 *
 * Eleven of the eighteen live mixing rows carry no percentage, because the
 * material master hides the % column for Single Yarn and yarn-dyed fabrics. The
 * tempting fallback is `1 / n`. A yarn-dyed stripe of two counts might be 50/50
 * or 90/10, so an equal split is an invented purchase quantity — section 3 pins
 * the refusal AND refutes 0.5, which is what that fallback returns.
 *
 * ## 3. THE FORMULA IS `x (1 + L)`, WHICH IS *NOT* THE FABRIC PLAN'S
 *
 * `order_fabric_plan_stages` (0427) solves the same kind of loss backwards, as
 * `output / (1 - L)`, and 0427's own vectors forbid the uplift form. Here the
 * client chose the uplift with both figures in front of them (2026-09-01), so
 * section 4 pins it and REFUTES 111.12. The two scripts forbid each other's
 * answers on purpose; a reader who "fixes" either to match the other breaks a
 * client decision, and only the client can reconcile them.
 *
 * ## 4. TWO STAGES COMPOUND, THEY DO NOT ADD
 *
 * 3% then 2% is `x 1.03 x 1.02` = 5.06%, not 5.00% — confirmed with the client
 * against that exact pair. The additive reading under-buys by a little on every
 * yarn, always in the same direction, and each line still looks right. Section 5
 * pins 1050.60 and REFUTES 1050.00.
 *
 * ## 5. `For` DIVIDES THE WEIGHT, IT DOES NOT LABEL THE ROW
 *
 * A stage marked For = PURPLE grosses up the purple share alone. Applying its
 * loss to the yarn's whole weight is the easy mistake and it over-buys the
 * colours nobody is dyeing. Section 6 pins 918 for the client's own worked
 * example and refutes 927, which is what charging every combo would give.
 *
 * Runs under `tsx` for `check-fabric-plan.mts`'s reason: the module imports
 * `@/lib/...` aliases at runtime and Node's ESM resolver reads neither the alias
 * nor the missing extension.
 */
import {
  comboUplift,
  deriveYarnRows,
  isRefusal,
  stageProcessQty,
  yarnNetByCombo,
  yarnPurchase,
  yarnShareOf,
  type FabricComposition,
  type FabricGross,
  type YarnAnswer,
} from "../lib/orders/fabric-bom/yarn-process.ts";

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

/** Asserts a value is NOT something — for the wrong answers a plausible
 *  implementation produces. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function refusalOf(v: unknown): string | null {
  return isRefusal(v) ? v.refused : null;
}
function qtyOf(v: ReturnType<typeof yarnPurchase>): number | string {
  return isRefusal(v) ? "refused" : v.qty;
}
function combosOf(v: ReturnType<typeof yarnPurchase>) {
  return isRefusal(v) ? "refused" : v.byCombo.map((c) => [c.combo, c.gross]);
}

// ---------------------------------------------------------------------------
// Fixtures — the live data's own shapes (checked against the database
// 2026-09-01), so a vector that passes here describes a fabric that exists.
// ---------------------------------------------------------------------------

const COTTON = "11111111-1111-1111-1111-111111111111";
const ELASTANE = "22222222-2222-2222-2222-222222222222";
const MELANGE = "33333333-3333-3333-3333-333333333333";
const KG = "kkkkkkkk-kkkk-kkkk-kkkk-kkkkkkkkkkkk";
const METRE = "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmm";

/** SOLID 1X1 LYCRA RIB (30'S COTTON COMBED 95%, 20'S ELASTANE 5%) — declared. */
const RIB: FabricComposition = {
  fabric_id: "rib",
  fabric_name: "SOLID 1X1 LYCRA RIB",
  components: [
    { yarn_id: COTTON, blend_pct: 95 },
    { yarn_id: ELASTANE, blend_pct: 5 },
  ],
};

/** SOLID PIQUE (10'S COMBED COTTON) — one yarn, NO percentage. */
const PIQUE: FabricComposition = {
  fabric_id: "pique",
  fabric_name: "SOLID PIQUE",
  components: [{ yarn_id: COTTON, blend_pct: null }],
};

/** YARN DYED SINGLE JERSEY (10'S COMBED COTTON, 10'S GREY MELANGE) — TWO yarns,
 *  NO percentages. The case that must refuse. */
const YD: FabricComposition = {
  fabric_id: "yd",
  fabric_name: "YARN DYED SINGLE JERSEY",
  components: [
    { yarn_id: COTTON, blend_pct: null },
    { yarn_id: MELANGE, blend_pct: null },
  ],
};

const map = (...fs: FabricComposition[]) => new Map(fs.map((f) => [f.fabric_id, f]));
const gross = (
  fabric_id: string,
  g: number | null,
  combo: string | null = null,
  uom_id: string | null = KG,
  refusal: string | null = null,
): FabricGross => ({ fabric_id, combo, gross: g, uom_id, refusal });

/* A STEP IS NOW ONLY ITS LOSS. It carried a `combo` until 0520 — the `For`
   column named a colourway and scoped the arithmetic to it. The client replaced
   those values with PROCESS WISE / COLOR WISE on 2026-09-03 knowing that removes
   the scoping, so a step no longer has anything to be matched on. `loss_for_id`
   is deliberately NOT here: nothing in this engine reads it, and a fixture field
   no assertion can move is a fixture field that lies about what matters. */
const stage = (loss_pct: number | null) => ({ loss_pct });

// ---------------------------------------------------------------------------
// 1. The rows are derived, de-duplicated and stable
// ---------------------------------------------------------------------------

const NAMES = new Map([
  [COTTON, { name: "30'S COTTON COMBED", inactive: false }],
  [ELASTANE, { name: "20'S ELASTANE", inactive: false }],
  [MELANGE, { name: "10'S GREY MELANGE", inactive: false }],
]);
const NO_ANSWERS = new Map<string, YarnAnswer>();

check(
  "one yarn in two fabrics is ONE row, not two",
  deriveYarnRows([RIB, PIQUE], NAMES, NO_ANSWERS).filter((r) => r.item_id === COTTON).length,
  1,
);
check(
  "…and it names both fabrics, sorted",
  deriveYarnRows([RIB, PIQUE], NAMES, NO_ANSWERS).find((r) => r.item_id === COTTON)?.fabrics,
  ["SOLID 1X1 LYCRA RIB", "SOLID PIQUE"],
);
check(
  "rows sort by yarn name, so the list does not shuffle when a fabric line moves",
  deriveYarnRows([RIB], NAMES, NO_ANSWERS).map((r) => r.name),
  ["20'S ELASTANE", "30'S COTTON COMBED"],
);
check(
  "stages re-attach by yarn id across a re-derivation",
  deriveYarnRows(
    [RIB, PIQUE],
    NAMES,
    new Map([
      [
        COTTON,
        {
          stages: [
            {
              key: "k1",
              stage_id: "s1",
              process_id: "p1",
              combo: "PURPLE",
              description: "",
              loss_pct: "3",
            },
          ],
        },
      ],
    ]),
  ).find((r) => r.item_id === COTTON)?.stages.length,
  1,
);
check(
  "a yarn no fabric declares any more produces no row at all",
  deriveYarnRows([PIQUE], NAMES, NO_ANSWERS).map((r) => r.item_id),
  [COTTON],
);

// ---------------------------------------------------------------------------
// 2. The blend share — the failure that looks completely normal on screen
// ---------------------------------------------------------------------------

check("a declared 95% is 0.95 of the cloth", yarnShareOf(RIB, COTTON), 0.95);
check("…and its partner is 0.05", yarnShareOf(RIB, ELASTANE), 0.05);
refute("a blended yarn is NOT charged the whole fabric", yarnShareOf(RIB, COTTON), 1);
check("a yarn the fabric does not name is 0", yarnShareOf(RIB, MELANGE), 0);
check(
  "one yarn with no percentage IS the whole fabric — the master hides the % for it",
  yarnShareOf(PIQUE, COTTON),
  1,
);

check(
  "1000 kg of a 95/5 rib buys 950 kg of cotton, not 1000",
  qtyOf(yarnPurchase(COTTON, [gross("rib", 1000)], map(RIB), [], 2)),
  950,
);
check(
  "…and 50 kg of elastane",
  qtyOf(yarnPurchase(ELASTANE, [gross("rib", 1000)], map(RIB), [], 2)),
  50,
);
refute(
  "…so the two yarns of one fabric never sum to twice its weight",
  qtyOf(yarnPurchase(COTTON, [gross("rib", 1000)], map(RIB), [], 2)),
  1000,
);
check(
  "a yarn in two fabrics sums across both",
  qtyOf(yarnPurchase(COTTON, [gross("rib", 1000), gross("pique", 500)], map(RIB, PIQUE), [], 2)),
  1450,
);

// ---------------------------------------------------------------------------
// 3. An undeclared blend refuses — it never splits equally
// ---------------------------------------------------------------------------

check(
  "two yarns and no percentages refuses, naming the fabric and the fix",
  refusalOf(yarnShareOf(YD, COTTON)),
  "YARN DYED SINGLE JERSEY names 2 yarns with no blend percentages, so its " +
    "weight cannot be split between them — enter the Mixing % on the material master",
);
refute("…and never falls back to 1/n", yarnShareOf(YD, COTTON), 0.5);
refute("…nor to the whole fabric", yarnShareOf(YD, COTTON), 1);
check(
  "the refusal propagates to the weight rather than being skipped",
  refusalOf(yarnPurchase(COTTON, [gross("yd", 1000)], map(YD), [], 2)),
  refusalOf(yarnShareOf(YD, COTTON)),
);
refute(
  "a yarn used by a good fabric AND a refusing one prints NO total — " +
    "two thirds of an answer looks like a whole one",
  qtyOf(yarnPurchase(COTTON, [gross("rib", 1000), gross("yd", 1000)], map(RIB, YD), [], 2)),
  950,
);

// ---------------------------------------------------------------------------
// 4. The per-stage form — the client's uplift, NOT the Fabric Plan's solve
// ---------------------------------------------------------------------------

check(
  "10% loss on 100 kg buys 110 — the client's own example, confirmed 2026-09-01",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), [stage(10)], 2)),
  110,
);
refute(
  "…and NOT 111.12, which is 0427's `output / (1 - L)`. The divergence was put " +
    "to the client and they chose this side; do not reconcile it in code",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), [stage(10)], 2)),
  111.12,
);
check(
  "the two forms agree at 0%, which is why the wrong one survives review",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), [stage(0)], 2)),
  100,
);
check(
  "no stage at all means no uplift — the solid flow, the ordinary case",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), [], 2)),
  100,
);
check(
  "the loss applies AFTER the blend share, not before",
  qtyOf(yarnPurchase(COTTON, [gross("rib", 1000)], map(RIB), [stage(10)], 2)),
  1045,
);
check(
  "rounded UP to the unit's precision — rounding down under-buys",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), [stage(2.345)], 2)),
  102.35,
);
check(
  "a 100% loss refuses",
  refusalOf(yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), [stage(100)], 2)),
  "Process loss must be 0 or more and below 100",
);
check(
  "a negative loss refuses",
  refusalOf(yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), [stage(-1)], 2)),
  "Process loss must be 0 or more and below 100",
);

// ---------------------------------------------------------------------------
// 5. TWO STAGES COMPOUND — x 1.03 x 1.02, never x 1.05
// ---------------------------------------------------------------------------

const TWO_STAGE = [stage(3), stage(2)];

check(
  "3% then 2% on 1000 kg buys 1050.60 — sequential, confirmed with the client",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), TWO_STAGE, 2)),
  1050.6,
);
refute(
  "…and NOT 1050.00, which is the additive reading. It under-buys on every " +
    "yarn, always in the same direction, and each line still looks right",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), TWO_STAGE, 2)),
  1050,
);
check("the uplift factor itself is 1.0506", comboUplift(TWO_STAGE), 1.0506);
check(
  "stage ORDER does not change the product — sno orders what is read, not the maths",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), [stage(2), stage(3)], 2)),
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), TWO_STAGE, 2)),
);
check(
  "three stages keep compounding",
  comboUplift([stage(10), stage(10), stage(10)]),
  1.3310000000000004,
);

// ---------------------------------------------------------------------------
// 6. THE NET STILL SPLITS BY COLOURWAY — the LOSS no longer does (0520)
//
// `For` named a colourway until 2026-09-03 and divided the weight with it: a
// step marked PURPLE grossed up the purple share alone, 618 + 300 = 918, and
// these vectors asserted that against the client's own worked example. The
// client then specified the column as "Process Wise, Color Wise" and confirmed
// it knowing two fixed words cannot name PURPLE. So the split is gone and 927 —
// which these vectors used to REFUTE by name — is now the right answer.
//
// THE HALF THAT SURVIVES IS ASSERTED HARDER FOR IT. The NET is still weighed per
// colourway, because that comes off the fabric's requirement and never off this
// column, and each lot is still rounded up on its own. Losing the loss scoping
// is not licence to sum the colourways first.
// ---------------------------------------------------------------------------

const TWO_COMBOS = [gross("pique", 600, "PURPLE"), gross("pique", 300, "GREEN")];

check(
  "the net splits by colourway before any loss",
  (() => {
    const r = yarnNetByCombo(COTTON, TWO_COMBOS, map(PIQUE));
    return isRefusal(r) ? "refused" : [...r.net].sort();
  })(),
  [
    ["GREEN", 300],
    ["PURPLE", 600],
  ],
);
check(
  "a 3% step now treats every colourway: 618 + 309 = 927",
  qtyOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), [stage(3)], 2)),
  927,
);
refute(
  "…never 918, which is the pre-0520 answer that grossed purple alone",
  qtyOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), [stage(3)], 2)),
  918,
);
check(
  "…and the breakdown still names each lot separately",
  combosOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), [stage(3)], 2)),
  [
    ["GREEN", 309],
    ["PURPLE", 618],
  ],
);
refute(
  "…so the colourways are never summed into one lot before the uplift",
  combosOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), [stage(3)], 2)),
  [["", 927]],
);
check(
  "no step at all leaves every colourway at its net",
  qtyOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), [], 2)),
  900,
);

// ---------------------------------------------------------------------------
// 7. What each step HANDLES — the Budget's Yarn Process line
// ---------------------------------------------------------------------------

const SPLIT = yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), [stage(3)], 2);
const BY_COMBO = isRefusal(SPLIT) ? [] : SPLIT.byCombo;

check("a step handles the yarn's whole purchase", stageProcessQty(BY_COMBO), 927);
refute(
  "…and is summed from the rounded-up lots, not re-derived from the total",
  stageProcessQty(BY_COMBO),
  BY_COMBO.reduce((a, c) => a + c.net, 0),
);

// ---------------------------------------------------------------------------
// 8. Nothing to compute against
// ---------------------------------------------------------------------------

check(
  "a fabric whose requirement was refused says so, and does not read as zero",
  refusalOf(yarnPurchase(COTTON, [gross("pique", null)], map(PIQUE), [], 2)),
  "SOLID PIQUE has no calculated requirement yet, so its yarn cannot be worked " +
    "out — answer its weight on Manual",
);
/* THE ENGINE'S OWN WORDS WHEN THERE ARE ANY (2026-09-03). The generic sentence
   above is the fallback; a refused slice already carries the sentence that names
   the fix, and reprinting it here is what turns "something is missing" into
   "fill in this size". The old wording ended "see Calculated Quantities" — a
   section removed from this screen on 2026-09-01, so it sent the operator to a
   rail row that is not there. */
check(
  "…and prefers the requirement engine's own sentence to the generic one",
  refusalOf(
    yarnPurchase(
      COTTON,
      [gross("pique", null, null, KG, "Enter the consumption for WHITE · S")],
      map(PIQUE),
      [],
      2,
    ),
  ),
  "SOLID PIQUE: Enter the consumption for WHITE · S",
);
refute(
  "…and never sends the operator to Calculated Quantities, removed 2026-09-01",
  refusalOf(yarnPurchase(COTTON, [gross("pique", null)], map(PIQUE), [], 2))?.includes(
    "Calculated Quantities",
  ),
  true,
);
refute(
  "…and never answers 0, which on a purchase line reads as 'buy nothing'",
  qtyOf(yarnPurchase(COTTON, [gross("pique", null)], map(PIQUE), [], 2)),
  0,
);
check(
  "mixed units refuse rather than adding kg to metres",
  refusalOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500, null, METRE)],
      map(RIB, PIQUE),
      [],
      2,
    ),
  ),
  "The fabrics using this yarn are measured in different units, so their " +
    "requirements cannot be added — give them one unit on Fabric Lines",
);
check(
  "a yarn no listed fabric uses refuses",
  refusalOf(yarnPurchase(MELANGE, [gross("rib", 1000)], map(RIB), [], 2)),
  "No fabric on this BOM uses this yarn",
);

console.log(failed === 0 ? "\nOK — every yarn-process vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
