/**
 * Vectors for `lib/orders/fabric-bom/yarn-process.ts` — Fabric BOM ▸ Yarn
 * Process, the tab that turns a fabric requirement into a YARN PURCHASE.
 *
 * Its output is the largest single quantity in a knitted order and it feeds the
 * Budget directly, so the failure modes here are money rather than pixels.
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
 * ## 3. THE FORMULA IS `/ (1 - L)`, REVERSED 2026-09-11 — SEE THE FUNCTION'S
 *   OWN HEADER FOR THE FULL HISTORY
 *
 * This section pinned `x (1 + L)` from 2026-09-01 to 2026-09-11 and refuted
 * `output / (1 - L)` (0427's `order_fabric_plan_stages` form) by name, on the
 * strength of an explicit client choice shown both figures. That choice was
 * REVERSED on 2026-09-11 — not by a redrafted spec (one was sent 2026-09-04
 * and explicitly declined, see the function header's account of that) but by
 * the LEGACY RP-SOFTWARE SYSTEM'S OWN PDF EXPORT, whose numbers were checked
 * arithmetically: Knitting's `1536.873 -> 1552.397` at 1% is exactly
 * `1536.873 / (1 - 0.01)`. Section 4 below now pins 111.12 and REFUTES 110 —
 * the exact reverse of what stood here yesterday. A reader who "fixes" this
 * back to `x(1+L)` on the strength of THIS COMMENT ALONE is repeating the
 * mistake the 2026-09-04 attempt made in the other direction: check
 * `yarn-process.ts`'s own header for whether a newer decision has overtaken
 * this one before trusting either formula.
 *
 * ## 4. STAGES COMPOUND, THEY DO NOT ADD — UNCHANGED BY THE REVERSAL
 *
 * 3% then 2% is `/ 0.97 / 0.98`, not one 5% divisor. Confirmed against the
 * legacy PDF's own multi-stage chain (Knitting -> Dyeing -> ... -> Stentering).
 * Section 5 pins 1051.97 and refutes both 1050.00 (additive) and 1050.60 (the
 * OLD uplift compounding — the exact figure that stood here before 09-11, kept
 * as an explicit refutation so a partial revert cannot silently pass).
 *
 * ## 5. `For` DIVIDES THE WEIGHT, IT DOES NOT LABEL THE ROW — UNCHANGED
 *
 * A stage marked For = PURPLE grosses up the purple share alone. Section 6
 * pins 918.56 (backward-markup) and refutes 927.84 (treating every colourway)
 * and 918 (the OLD uplift figure for the same scoped case).
 *
 * ## 6. THE STAGE SOURCE MOVED: PER-FABRIC ROUTE, NOT PER-YARN TYPING
 *
 * `yarnPurchase` gained a `routesByFabric` parameter (2026-09-11) — see its
 * own header on why (`order_fabric_bom_yarn_stages` held zero rows anywhere in
 * the live database; `order_fabric_bom_processes`, the Fabric Process tab's
 * per-FABRIC declared route, held real ones, and the legacy PDF's own stage
 * sections are keyed to the fabric, not the yarn). Every vector below that
 * used to pass a stage list as `yarnPurchase`'s 4th argument now passes it as
 * that FABRIC's route via the `routes()` helper; a handful of new vectors in
 * section 9 cover the case a stage is ALSO typed on the yarn's own row
 * (`yarnOwnStages`, the 5th argument) and prove it COMPOUNDS onto the fabric's
 * route rather than replacing it, and that two fabrics with DIFFERENT routes
 * are each grossed by their OWN route before their shares of one yarn are
 * summed — the defect a flat "sum net first, uplift once" design cannot avoid.
 *
 * Runs under `tsx` for `check-fabric-plan.mts`'s reason: the module imports
 * `@/lib/...` aliases at runtime and Node's ESM resolver reads neither the alias
 * nor the missing extension.
 */
import {
  comboUplift,
  deriveYarnRows,
  isRefusal,
  stageProblem,
  stageProcessQty,
  yarnNetByCombo,
  yarnPurchase,
  shadeDyeFactor,
  type YarnShade,
  yarnShareOf,
  type FabricComposition,
  type FabricGross,
  type YarnAnswer,
} from "../lib/orders/fabric-bom/yarn-process.ts";
/* §10 — WHERE THE CLOTH COMES FROM (0564). */
import type { FabricSource } from "../lib/orders/fabric-bom/fabric-source.ts";

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

/* TWO MORE SINGLE-YARN CLOTHS OF THE SAME YARN — HO/RE/26-27/0007's own shape,
   where the three cloths feeding 10'S COMBED COTTON are mastered in three
   DIFFERENT buying units (KGS, NOS, MTR) while their requirements are all
   kilograms. See the 0562 vector in section 8. */
const SOLID_CUFF: FabricComposition = {
  fabric_id: "rib2",
  fabric_name: "SOLID CUFF",
  components: [{ yarn_id: COTTON, blend_pct: null }],
};
const SOLID_CHAMBRAY: FabricComposition = {
  fabric_id: "yd2",
  fabric_name: "SOLID CHAMBRAY",
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

/* A STEP IS ITS LOSS AND ITS COLOURWAY AGAIN (0529). `loss_for_id` is
   deliberately NOT here: nothing in this engine reads it — it is the `For`
   column's LABEL, not its arithmetic — and a fixture field no assertion can
   move is a fixture field that lies about what matters. `combo` defaults to
   `null`, "every colourway", so every vector before section 6 is unaffected by
   its return. */
const stage = (loss_pct: number | null, combo: string | null = null) => ({ loss_pct, combo });

/** One fabric's declared route, as `yarnPurchase`'s `routesByFabric` map
 *  wants it (2026-09-11). Most vectors here have exactly one fabric, so this
 *  is the common case; section 9 builds a two-entry map by hand for the
 *  two-different-routes vectors. */
const routes = (fabricId: string, stages: { loss_pct: number | null; combo: string | null }[]) =>
  new Map([[fabricId, stages]]);
const NO_ROUTES = new Map<string, { loss_pct: number | null; combo: string | null }[]>();
const NO_OWN_STAGES: { loss_pct: number | null; combo: string | null }[] = [];

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
  qtyOf(yarnPurchase(COTTON, [gross("rib", 1000)], map(RIB), NO_ROUTES, NO_OWN_STAGES, 2)),
  950,
);
check(
  "…and 50 kg of elastane",
  qtyOf(yarnPurchase(ELASTANE, [gross("rib", 1000)], map(RIB), NO_ROUTES, NO_OWN_STAGES, 2)),
  50,
);
refute(
  "…so the two yarns of one fabric never sum to twice its weight",
  qtyOf(yarnPurchase(COTTON, [gross("rib", 1000)], map(RIB), NO_ROUTES, NO_OWN_STAGES, 2)),
  1000,
);
check(
  "a yarn in two fabrics sums across both",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500)],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
    ),
  ),
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
  refusalOf(yarnPurchase(COTTON, [gross("yd", 1000)], map(YD), NO_ROUTES, NO_OWN_STAGES, 2)),
  refusalOf(yarnShareOf(YD, COTTON)),
);
refute(
  "a yarn used by a good fabric AND a refusing one prints NO total — " +
    "two thirds of an answer looks like a whole one",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("yd", 1000)],
      map(RIB, YD),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
    ),
  ),
  950,
);

// ---------------------------------------------------------------------------
// 4. The per-stage form — backward-markup, `/(1-L)`, reversed 2026-09-11
// ---------------------------------------------------------------------------

check(
  "10% loss on 100 kg buys 111.12 — 0427's `output / (1 - L)`, confirmed against " +
    "the legacy PDF's own numbers 2026-09-11",
  qtyOf(
    yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), routes("pique", [stage(10)]), NO_OWN_STAGES, 2),
  ),
  111.12,
);
refute(
  "…and NOT 110, which was the `x(1+L)` uplift this file pinned from 2026-09-01 " +
    "to 2026-09-11 — the client's own reversal, on the legacy system's own export",
  qtyOf(
    yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), routes("pique", [stage(10)]), NO_OWN_STAGES, 2),
  ),
  110,
);
check(
  "the two forms agree at 0%, which is why the wrong one survives review",
  qtyOf(
    yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), routes("pique", [stage(0)]), NO_OWN_STAGES, 2),
  ),
  100,
);
check(
  "no stage at all means no markup — the solid flow, the ordinary case",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), NO_ROUTES, NO_OWN_STAGES, 2)),
  100,
);
check(
  "the loss applies AFTER the blend share, not before",
  qtyOf(yarnPurchase(COTTON, [gross("rib", 1000)], map(RIB), routes("rib", [stage(10)]), NO_OWN_STAGES, 2)),
  1055.56,
);
check(
  "rounded UP to the unit's precision — rounding down under-buys",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("pique", 100)],
      map(PIQUE),
      routes("pique", [stage(2.345)]),
      NO_OWN_STAGES,
      2,
    ),
  ),
  102.41,
);
check(
  "a 100% loss refuses",
  refusalOf(
    yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), routes("pique", [stage(100)]), NO_OWN_STAGES, 2),
  ),
  "Process loss must be 0 or more and below 100",
);
check(
  "a negative loss refuses",
  refusalOf(
    yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), routes("pique", [stage(-1)]), NO_OWN_STAGES, 2),
  ),
  "Process loss must be 0 or more and below 100",
);

// ---------------------------------------------------------------------------
// 5. TWO STAGES COMPOUND — / 0.97 / 0.98, never / 0.95 (one 5% divisor)
// ---------------------------------------------------------------------------

const TWO_STAGE = [stage(3), stage(2)];

check(
  "3% then 2% on 1000 kg buys 1051.97 — sequential, confirmed against the legacy PDF",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), routes("pique", TWO_STAGE), NO_OWN_STAGES, 2)),
  1051.97,
);
refute(
  "…and NOT 1050.00, the additive reading (one 5% divisor)",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), routes("pique", TWO_STAGE), NO_OWN_STAGES, 2)),
  1050,
);
refute(
  "…and NOT 1050.60 either — the OLD `x1.03 x1.02` uplift figure this file " +
    "pinned before the 2026-09-11 reversal. A partial revert must not pass",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), routes("pique", TWO_STAGE), NO_OWN_STAGES, 2)),
  1050.6,
);
check("the markup factor itself is ~1.051967", Number(comboUplift(TWO_STAGE, "").toFixed(6)), 1.051967);
check(
  "stage ORDER does not change the product — sno orders what is read, not the maths",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), routes("pique", [stage(2), stage(3)]), NO_OWN_STAGES, 2)),
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), routes("pique", TWO_STAGE), NO_OWN_STAGES, 2)),
);
check(
  "three stages keep compounding",
  Number(comboUplift([stage(10), stage(10), stage(10)], "").toFixed(6)),
  1.371742,
);

// ---------------------------------------------------------------------------
// 6. `For` NAMES A COLOURWAY AND DIVIDES THE LOSS WITH IT (0504, restored
//    0529) — UNCHANGED BY THE FORMULA REVERSAL, numbers updated to match
//
// A step marked For = PURPLE grosses up the purple share alone: 618.56 + 300
// = 918.56. A step naming NO colourway — Process Wise, or `For` left blank —
// still treats every one: 618.56 + 309.28 = 927.84.
//
// THE NET SPLITS BY COLOURWAY REGARDLESS, and this was never in question: it
// comes off the fabric's requirement, not off `For`, and each lot is still
// rounded up on its own — the formula reversal was never licence to sum the
// colourways first.
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
  "a step marked For = PURPLE grosses up the purple share alone: 618.56 + 300 = 918.56",
  qtyOf(
    yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), routes("pique", [stage(3, "PURPLE")]), NO_OWN_STAGES, 2),
  ),
  918.56,
);
refute(
  "…never 927.84, which is what treating every colourway would give",
  qtyOf(
    yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), routes("pique", [stage(3, "PURPLE")]), NO_OWN_STAGES, 2),
  ),
  927.84,
);
refute(
  "…and never 918, the OLD uplift figure for this exact scoped case",
  qtyOf(
    yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), routes("pique", [stage(3, "PURPLE")]), NO_OWN_STAGES, 2),
  ),
  918,
);
check(
  "…and the breakdown grosses only the named lot",
  combosOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), routes("pique", [stage(3, "PURPLE")]), NO_OWN_STAGES, 2)),
  [
    ["GREEN", 300],
    ["PURPLE", 618.56],
  ],
);
check(
  "a step naming NO colourway still treats every one: 618.56 + 309.28 = 927.84",
  qtyOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), routes("pique", [stage(3)]), NO_OWN_STAGES, 2)),
  927.84,
);
refute(
  "…so an unscoped step is never mistaken for one scoped to a single lot",
  combosOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), routes("pique", [stage(3)]), NO_OWN_STAGES, 2)),
  [["", 927.84]],
);
check(
  "no step at all leaves every colourway at its net",
  qtyOf(yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), NO_ROUTES, NO_OWN_STAGES, 2)),
  900,
);

// ---------------------------------------------------------------------------
// 7. What each step HANDLES — the Budget's Yarn Process line
// ---------------------------------------------------------------------------

const PURPLE_SPLIT = yarnPurchase(
  COTTON,
  TWO_COMBOS,
  map(PIQUE),
  routes("pique", [stage(3, "PURPLE")]),
  NO_OWN_STAGES,
  2,
);
const PURPLE_BY_COMBO = isRefusal(PURPLE_SPLIT) ? [] : PURPLE_SPLIT.byCombo;
const UNSCOPED_SPLIT = yarnPurchase(COTTON, TWO_COMBOS, map(PIQUE), routes("pique", [stage(3)]), NO_OWN_STAGES, 2);
const UNSCOPED_BY_COMBO = isRefusal(UNSCOPED_SPLIT) ? [] : UNSCOPED_SPLIT.byCombo;

check(
  "a step marked For = PURPLE handles only the purple lot",
  stageProcessQty("PURPLE", PURPLE_BY_COMBO),
  618.56,
);
check(
  "…and a step naming no colourway handles the whole purchase",
  stageProcessQty(null, UNSCOPED_BY_COMBO),
  927.84,
);
check(
  "…and 'this BOM needs no SCARLET' when a stage names one the requirement lacks",
  stageProblem("SCARLET", PURPLE_BY_COMBO),
  "This BOM needs no SCARLET of this yarn — check the For column against the order's colourways",
);
refute(
  "…and is summed from the rounded-up lots, not re-derived from the total",
  stageProcessQty("PURPLE", PURPLE_BY_COMBO),
  PURPLE_BY_COMBO.reduce((a, c) => a + c.net, 0),
);

// ---------------------------------------------------------------------------
// 8. Nothing to compute against
// ---------------------------------------------------------------------------

check(
  "a fabric whose requirement was refused says so, and does not read as zero",
  refusalOf(yarnPurchase(COTTON, [gross("pique", null)], map(PIQUE), NO_ROUTES, NO_OWN_STAGES, 2)),
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
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
    ),
  ),
  "SOLID PIQUE: Enter the consumption for WHITE · S",
);
refute(
  "…and never sends the operator to Calculated Quantities, removed 2026-09-01",
  refusalOf(yarnPurchase(COTTON, [gross("pique", null)], map(PIQUE), NO_ROUTES, NO_OWN_STAGES, 2))?.includes(
    "Calculated Quantities",
  ),
  true,
);
refute(
  "…and never answers 0, which on a purchase line reads as 'buy nothing'",
  qtyOf(yarnPurchase(COTTON, [gross("pique", null)], map(PIQUE), NO_ROUTES, NO_OWN_STAGES, 2)),
  0,
);
check(
  "mixed units refuse rather than adding kg to metres",
  refusalOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500, null, METRE)],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
    ),
  ),
  "The fabrics using this yarn are measured in different units, so their " +
    "requirements cannot be added — give them one unit on Fabric Allocation",
);
check(
  "a yarn no listed fabric uses refuses",
  refusalOf(yarnPurchase(MELANGE, [gross("rib", 1000)], map(RIB), NO_ROUTES, NO_OWN_STAGES, 2)),
  "No fabric on this BOM uses this yarn",
);

/* ...AND THE SAME THREE FIGURES SUM ONCE THEY ARE LABELLED ALIKE — the live
   defect behind 0562, pinned here because the two vectors differ in NOTHING
   but the label.

   On HO/RE/26-27/0007 one yarn (10'S COMBED COTTON) feeds three cloths whose
   requirements are 214, 16.05 and 10.7 — all three computed by `consumptionMap`
   as `cons_qty x grams / 1000`, i.e. all three KILOGRAMS. `requirementRows`
   stamped each row with its cloth's `items.base_uom_id` instead (KGS, NOS and
   MTR), so the refusal above fired over three weights that were never in
   different units, `purchase_qty` stored NULL, and the Yarn & Fabric
   Requirement Report printed a TOTAL YARN PURCHASE REQUIREMENT of 0.

   The refusal is RIGHT and stays: kg genuinely cannot be added to metres. What
   was wrong was upstream, and the guard against it recurring is that these two
   vectors sit side by side — anything that re-derives a requirement's unit
   per fabric turns the second one back into the first. */
check(
  "three cloths of one yarn, all in one unit, sum: 214 + 16.05 + 10.7 = 240.75",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("pique", 214), gross("rib2", 16.05), gross("yd2", 10.7)],
      map(PIQUE, SOLID_CUFF, SOLID_CHAMBRAY),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
    ),
  ),
  240.75,
);

// ---------------------------------------------------------------------------
// 9. EACH FABRIC APPLIES ITS OWN ROUTE, THEN MERGES (2026-09-11) — the defect
//    a "sum net first, uplift once" design cannot express
//
// COTTON is shared by a fleece (Brushing, 2% loss) and a plain jersey (no
// Brushing at all) — the legacy PDF's own 32'S BCI COTTON shape. Summing
// their nets FIRST and applying one factor would either charge the jersey for
// Brushing it never runs through, or spare the fleece a loss it does.
// ---------------------------------------------------------------------------

const FLEECE: FabricComposition = {
  fabric_id: "fleece",
  fabric_name: "3T FLEECE BRUSHED",
  components: [{ yarn_id: COTTON, blend_pct: null }],
};

check(
  "two fabrics sharing a yarn, each grossed by its OWN route: " +
    "1000/0.98 (fleece, Brushing 2%) + 500 (jersey, no route) = 1520.41",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("fleece", 1000), gross("pique", 500)],
      map(FLEECE, PIQUE),
      routes("fleece", [stage(2)]),
      NO_OWN_STAGES,
      2,
    ),
  ),
  1520.41,
);
refute(
  "…never 1530.00, which is what applying the fleece's 2% to BOTH fabrics' " +
    "combined net (1500 x 1.02, additive) would give — the exact double-charge " +
    "a flat 'sum net first' design cannot avoid",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("fleece", 1000), gross("pique", 500)],
      map(FLEECE, PIQUE),
      routes("fleece", [stage(2)]),
      NO_OWN_STAGES,
      2,
    ),
  ),
  1530,
);
check(
  "…and byFabric names which cloth produced which share, unmerged",
  (() => {
    const r = yarnPurchase(
      COTTON,
      [gross("fleece", 1000), gross("pique", 500)],
      map(FLEECE, PIQUE),
      routes("fleece", [stage(2)]),
      NO_OWN_STAGES,
      2,
    );
    return isRefusal(r) ? "refused" : r.byFabric.map((f) => f.fabric_id).sort();
  })(),
  ["fleece", "pique"],
);

check(
  "a stage still typed on the YARN'S OWN row COMPOUNDS onto its fabric's route, " +
    "never replaces it: pique (no route) x a yarn-own 5% = 105.27",
  qtyOf(
    yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), NO_ROUTES, [stage(5)], 2),
  ),
  105.27,
);
check(
  "…and the two sources compound WITH each other: fabric route 1% x yarn-own 5%" +
    " on 100 = 106.33",
  qtyOf(
    yarnPurchase(COTTON, [gross("pique", 100)], map(PIQUE), routes("pique", [stage(1)]), [stage(5)], 2),
  ),
  106.33,
);

// ---------------------------------------------------------------------------
// 10. A FABRIC BOUGHT AS CLOTH BUYS NO YARN (0564, 2026-09-16) —
//     `doc/order/fabriprocess.md` §2, Default Rule No. 2.
//
//     "Selecting Greige Fabric Purchase disables and suppresses Yarn Purchase
//     and Knitting in the calculation engine." The LADDER half of that
//     sentence is pinned in `check-fabric-bom-reports.mts` §9; this section is
//     the YARN half, which is the expensive one — the largest single quantity
//     in a knitted order, and a figure a purchase order is raised against.
//
//     ## THE SKIP IS NOT FLAG-DEPENDENT, AND THAT IS DELIBERATE
//
//     The ladder's suppression needs the process master's `is_knitting` flag
//     and therefore degrades quietly if nobody ticks it (it over-buys by a
//     percent or two — see §9). This half needs no flag at all: the fabric's
//     own source is enough, so the yarn cannot be re-bought by an unticked
//     checkbox. The vectors below assert the skip happens on the SOURCE and
//     nothing else.
//
//     DEMONSTRATED FAILING FIRST (2026-09-16) — see the report for the counts.
// ---------------------------------------------------------------------------

const sources = (...pairs: [string, FabricSource][]) => new Map(pairs);

check(
  "Rule 1 is untouched: passing no source map at all buys exactly what it always did",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500)],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
    ),
  ),
  1450,
);
check(
  "…and naming every fabric `yarn_knit` explicitly is the same figure, not a near one",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500)],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["rib", "yarn_knit"], ["pique", "yarn_knit"]),
    ),
  ),
  1450,
);

check(
  "a cloth bought as GREIGE ROLLS drops out of the yarn sum — 1450 becomes 950, " +
    "the rib's share alone",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500)],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["pique", "greige_purchase"]),
    ),
  ),
  950,
);
refute(
  "…and never 1450, which is the figure a Source ▾ the engine ignored would print",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500)],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["pique", "greige_purchase"]),
    ),
  ),
  1450,
);
check(
  "a cloth bought as DYED ROLLS drops out for the same reason",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500)],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["pique", "dyed_purchase"]),
    ),
  ),
  950,
);

check(
  "a yarn whose EVERY cloth is bought as cloth refuses in its own words — " +
    "never 'no fabric uses this yarn', which sends a buyer chasing a data problem",
  refusalOf(
    yarnPurchase(
      COTTON,
      [gross("pique", 500)],
      map(PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["pique", "greige_purchase"]),
    ),
  ),
  "Every fabric using this yarn is bought as cloth, so no yarn is purchased " +
    "for it — see the fabric purchase requirement instead",
);
check(
  "…while a yarn genuinely on no fabric still says exactly that",
  refusalOf(
    yarnPurchase(MELANGE, [gross("pique", 500)], map(PIQUE), NO_ROUTES, NO_OWN_STAGES, 2),
  ),
  "No fabric on this BOM uses this yarn",
);
refute(
  "…and a purchased cloth never answers 0, which on a purchase line reads as 'buy nothing'",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("pique", 500)],
      map(PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["pique", "greige_purchase"]),
    ),
  ),
  0,
);

check(
  "THE SKIP COMES BEFORE THE BLEND GUARD: a purchased cloth whose blend is " +
    "undeclared does not refuse the whole yarn — there is no yarn to work out",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("yd", 400)],
      map(RIB, YD),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["yd", "greige_purchase"]),
    ),
  ),
  950,
);
check(
  "THE SKIP COMES BEFORE THE 'no requirement yet' GUARD too — a greige roll " +
    "bought from the market has no yarn whether or not its weight was answered",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", null, null, KG, "Enter the consumption for WHITE · S")],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["pique", "greige_purchase"]),
    ),
  ),
  950,
);
refute(
  "…and the SAME pair under Rule 1 still refuses, so the skip is doing the " +
    "work rather than the guard having been loosened",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", null, null, KG, "Enter the consumption for WHITE · S")],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
    ),
  ),
  950,
);

check(
  "a source naming a fabric this yarn never touches changes nothing",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("rib", 1000)],
      map(RIB),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["some-other-cloth", "greige_purchase"]),
    ),
  ),
  950,
);
check(
  "a purchased cloth leaves the byFabric breakdown too, not just the total — " +
    "a drill-down showing a weight no purchase order exists for is the same lie",
  (() => {
    const r = yarnPurchase(
      COTTON,
      [gross("rib", 1000), gross("pique", 500)],
      map(RIB, PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      sources(["pique", "greige_purchase"]),
    );
    return isRefusal(r) ? "refused" : r.byFabric.map((f) => f.fabric_id);
  })(),
  ["rib"],
);

// ---------------------------------------------------------------------------
// THE DYE HOUSE'S PER-SHADE LOSS (0568)
//
// Legacy, "Yarndyed _Format.pdf", YARN DYEING — one yarn, three shades, three
// different losses, and the total is what YARN PURCHASE (GREY) buys:
//
//   20'S COMBED COTTON  GREEN  510.500  5.00  537.368
//                       RED    340.299  4.00  354.478
//                       WHITE  170.201  3.00  175.465
//                       Total 1021.000        1067.311
//
// Until 0568 nothing could hold a loss per shade, so every colour of a yarn
// showed that yarn's single stage loss and the grey purchase was the dyed
// weight un-grossed — step 3 of the client's formula was a no-op.
// ---------------------------------------------------------------------------

const KNIT_GROSS_YD = 1021;
/** Legacy's three stripes: 6 / 4 / 2 of the yarn, at 5% / 4% / 3%. */
const LEGACY_SHADES: YarnShade[] = [
  { fabric_id: "yd", yarn_id: COTTON, combo: null, share: 6 / 12, loss_pct: 5 },
  { fabric_id: "yd", yarn_id: COTTON, combo: null, share: 4 / 12, loss_pct: 4 },
  { fabric_id: "yd", yarn_id: COTTON, combo: null, share: 2 / 12, loss_pct: 3 },
];
const dyeFactorOf = (v: number | Refusal) => (isRefusal(v) ? "refused" : v);

/* 1067.312, WHERE THE LEGACY SHEET PRINTS 1067.311 — one gram, and it is
   legacy's rounding rather than a disagreement about the arithmetic. It shows
   33.33% and 16.67% and computed its rows FROM those rounded figures
   (1021 x 33.33% = 340.299 exactly); this engine divides the exact thirds and
   displays the rounded ones. The same gram is documented in
   `check-fabric-bom-reports.mts` for the same reason. Pinned at the true value,
   so a future "fix" toward legacy's printed total has to argue with this
   comment first. */
check(
  "the three shades gross 1021.000 kg of dyed yarn to 1067.312 kg of grey",
  Number(
    (KNIT_GROSS_YD * (dyeFactorOf(shadeDyeFactor(LEGACY_SHADES, "yd", COTTON, "")) as number)).toFixed(3),
  ),
  1067.312,
);
/* IT IS A WEIGHTED SUM AND NOT ONE AVERAGED DIVISION, which is the whole reason
   the factor is built per shade. The share-weighted mean loss here is 4.333%,
   and applying that to the whole yarn buys 1067.246 — 65 grams light, on one
   cloth, from an arithmetic shortcut that looks equivalent. */
refute(
  "…never by applying one averaged loss to the whole yarn",
  Number((KNIT_GROSS_YD / (1 - 0.0433333333)).toFixed(3)),
  1067.311,
);
/* GREEN MATCHES LEGACY TO THE GRAM (537.368), because a half is a half however
   it is rounded. RED and WHITE differ — 354.514 against legacy's 354.478, and
   175.430 against its 175.465 — for the reason above. */
check(
  "each shade alone: GREEN matches legacy exactly, RED and WHITE by its rounding",
  [
    Number(((KNIT_GROSS_YD * (6 / 12)) / (1 - 0.05)).toFixed(3)),
    Number(((KNIT_GROSS_YD * (4 / 12)) / (1 - 0.04)).toFixed(3)),
    Number(((KNIT_GROSS_YD * (2 / 12)) / (1 - 0.03)).toFixed(3)),
  ],
  [537.368, 354.514, 175.43],
);

check(
  "a yarn with NO shades declared grosses by nothing — the pre-0568 answer",
  dyeFactorOf(shadeDyeFactor([], "yd", COTTON, "")),
  1,
);
check(
  "…and so does a shade whose loss is 0: nothing declared is not a loss to invent",
  dyeFactorOf(
    shadeDyeFactor([{ fabric_id: "yd", yarn_id: COTTON, combo: null, share: 1, loss_pct: 0 }], "yd", COTTON, ""),
  ),
  1,
);

/* SCOPED THREE WAYS. A shade belongs to one cloth, one yarn and one colourway —
   reading another's would gross a weight by a loss that was never about it. */
check(
  "shades of a DIFFERENT fabric are not read",
  dyeFactorOf(shadeDyeFactor(LEGACY_SHADES, "other-fabric", COTTON, "")),
  1,
);
check(
  "shades of a DIFFERENT yarn are not read",
  dyeFactorOf(shadeDyeFactor(LEGACY_SHADES, "yd", MELANGE, "")),
  1,
);
check(
  "shades of a DIFFERENT colourway are not read",
  dyeFactorOf(shadeDyeFactor(LEGACY_SHADES, "yd", COTTON, "PURPLE")),
  1,
);

/* SHARES THAT DO NOT ACCOUNT FOR THE WHOLE YARN ARE REFUSED, never scaled to
   fit — rescaling would hand a missing stripe's weight to the others and invent
   a split nobody typed. */
check(
  "stripes summing to less than the whole yarn refuse",
  refusalOf(
    shadeDyeFactor(
      [{ fabric_id: "yd", yarn_id: COTTON, combo: null, share: 0.5, loss_pct: 5 }],
      "yd",
      COTTON,
      "",
    ),
  )?.startsWith("This fabric's yarn-dyed stripes do not account for the whole yarn"),
  true,
);
refute(
  "…rather than quietly rescaling the half that is there",
  dyeFactorOf(
    shadeDyeFactor(
      [{ fabric_id: "yd", yarn_id: COTTON, combo: null, share: 0.5, loss_pct: 5 }],
      "yd",
      COTTON,
      "",
    ),
  ),
  1 / (1 - 0.05),
);
check(
  "a loss at or over 100% refuses rather than dividing by zero",
  refusalOf(
    shadeDyeFactor(
      [{ fabric_id: "yd", yarn_id: COTTON, combo: null, share: 1, loss_pct: 100 }],
      "yd",
      COTTON,
      "",
    ),
  ),
  "A dyeing loss of 100% is out of range — enter a percentage under 100",
);

/* THE ORDER OF THE TWO MARKUPS IS THE PHYSICAL ORDER READ BACKWARDS — the
   cloth's route grosses to grey-KNITTED weight, and the yarn was dyed before it
   was knitted, so the dye loss grosses what comes out of that. Multiplication
   commutes, so this vector pins the COMBINED factor rather than the sequence,
   which is what any reordering would have to preserve. */
check(
  "route 1% then a 5% single shade = 100 / 0.99 / 0.95 = 106.33",
  Number(
    (
      100 *
      (dyeFactorOf(
        shadeDyeFactor(
          [{ fabric_id: "pique", yarn_id: COTTON, combo: null, share: 1, loss_pct: 5 }],
          "pique",
          COTTON,
          "",
        ),
      ) as number) *
      (comboUplift([stage(1)], "") as number)
    ).toFixed(2),
  ),
  106.33,
);

/* END TO END THROUGH `yarnPurchase`, which is what actually writes
   `purchase_qty` — the figure a yarn PO is raised against. */
check(
  "yarnPurchase grosses a single-yarn cloth by its shades: 1000 -> 1041.78",
  qtyOf(
    yarnPurchase(
      COTTON,
      [gross("pique", 1000)],
      map(PIQUE),
      NO_ROUTES,
      NO_OWN_STAGES,
      2,
      new Map(),
      [
        { fabric_id: "pique", yarn_id: COTTON, combo: null, share: 0.5, loss_pct: 5 },
        { fabric_id: "pique", yarn_id: COTTON, combo: null, share: 0.5, loss_pct: 3 },
      ],
    ),
  ),
  1041.78,
);
check(
  "…and with no shades passed it is unchanged at 1000, as every caller before 0568 got",
  qtyOf(yarnPurchase(COTTON, [gross("pique", 1000)], map(PIQUE), NO_ROUTES, NO_OWN_STAGES, 2)),
  1000,
);

console.log(failed === 0 ? "\nOK — every yarn-process vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
