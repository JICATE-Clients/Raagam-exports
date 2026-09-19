/**
 * IWO Fabric BOM ▸ step 3 — the typed Req Wt, through the ORDER engine, to a
 * yarn purchase.
 *
 *     npm run check:iwo-fabric-bom
 *
 * The IWO copy replaces ONE link of the order chain — where a fabric's gross
 * weight comes from (typed, not pieces × grams) — and reuses everything after
 * it: `comboUplift`, `yarnShareOf`, `yarnPurchase`. These vectors pin that the
 * replacement feeds the engine what it expects, and that the rule the client
 * settled on 2026-09-18 holds: a loss DIVIDES (1000 kg at 10% needs 1111.11),
 * it never MULTIPLIES (1100). The pasted specs kept asking for 1100; the
 * refutation below is what stops a well-meaning edit from giving it to them.
 */

import {
  comboUplift,
  isRefusal,
  yarnPurchase,
  type FabricComposition,
} from "../lib/orders/fabric-bom/yarn-process.ts";
import { iwoFabricGross, iwoRoutesByFabric, iwoYarnModePurchase } from "../lib/orders/iwo-fabric-bom/yarn.ts";
import { iwoYarnLineProblems, keptIwoYarnLines } from "../lib/orders/iwo-fabric-bom/lines.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else console.log(`ok    ${label}`);
}
function refute(label: string, actual: unknown, forbidden: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else console.log(`ok    ${label}`);
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const KG = "kg-uom";
const FAB = "fab-1";
const FAB2 = "fab-2";
const COTTON = "yarn-cotton";
const LYCRA = "yarn-lycra";
const name = (id: string) => (id === FAB ? "SINGLE JERSEY" : "RIB");

const comps = new Map<string, FabricComposition>([
  [FAB, { fabric_id: FAB, fabric_name: "SINGLE JERSEY", components: [{ yarn_id: COTTON, blend_pct: null }] }],
  [
    FAB2,
    {
      fabric_id: FAB2,
      fabric_name: "RIB",
      components: [
        { yarn_id: COTTON, blend_pct: 60 },
        { yarn_id: LYCRA, blend_pct: 40 },
      ],
    },
  ],
]);
const noKinds = new Map<string, { is_knitting: boolean; is_dyeing: boolean }>();
const buy = (yarnId: string, lines: { item_id: string; req_kgs: number | null }[], steps: Parameters<typeof iwoRoutesByFabric>[0]) =>
  yarnPurchase(yarnId, iwoFabricGross(lines, KG, name), comps, iwoRoutesByFabric(steps, noKinds), [], 3, new Map(), []);
const qty = (w: ReturnType<typeof buy>) => (isRefusal(w) ? w : r3(w.qty));

// §1 — the gross IS the typed weight; lines of one fabric sum.
check(
  "§1 two lines of one fabric sum into one gross",
  iwoFabricGross([{ item_id: FAB, req_kgs: 600 }, { item_id: FAB, req_kgs: 400 }], KG, name).map((g) => g.gross),
  [1000],
);

// §2 — no route: the yarn is the cloth, one-for-one (single yarn, no blend %).
check("§2 1000 kg, no route, single yarn = 1000", qty(buy(COTTON, [{ item_id: FAB, req_kgs: 1000 }], [])), 1000);

// §3 — THE CLIENT'S RULE: a 10% loss DIVIDES.
const tenPct = [{ item_id: FAB, stage_id: null, process_id: "knit", loss_pct: 10 }];
check("§3 1000 kg at 10% needs 1111.112 kg (÷0.9, rounded UP to 3dp)", qty(buy(COTTON, [{ item_id: FAB, req_kgs: 1000 }], tenPct)), 1111.112);
refute("§3 …and never the multiplied 1100", qty(buy(COTTON, [{ item_id: FAB, req_kgs: 1000 }], tenPct)), 1100);

// §4 — steps COMPOUND: 3% then 2% is ÷0.97÷0.98, not ÷0.95.
const factor = comboUplift(
  iwoRoutesByFabric(
    [
      { item_id: FAB, stage_id: null, process_id: "knit", loss_pct: 3 },
      { item_id: FAB, stage_id: null, process_id: "dye", loss_pct: 2 },
    ],
    noKinds,
  ).get(FAB) ?? [],
  "",
  [],
);
check("§4 3% then 2% compounds to 1/(0.97*0.98)", isRefusal(factor) ? factor : r3(factor), r3(1 / (0.97 * 0.98)));

// §5 — the BLEND splits the cloth before the loss lands.
check("§5 60% cotton of 1000 kg rib at 10% = 666.667", qty(buy(COTTON, [{ item_id: FAB2, req_kgs: 1000 }], [
  { item_id: FAB2, stage_id: null, process_id: "knit", loss_pct: 10 },
])), 666.667);
check("§5 40% lycra of the same = 444.445", qty(buy(LYCRA, [{ item_id: FAB2, req_kgs: 1000 }], [
  { item_id: FAB2, stage_id: null, process_id: "knit", loss_pct: 10 },
])), 444.445);

// §6 — one yarn in two fabrics: each fabric's share through its OWN route.
check(
  "§6 cotton in jersey (1000, no route) + rib (1000 at 10%) = 1000 + 666.667",
  qty(buy(COTTON, [{ item_id: FAB, req_kgs: 1000 }, { item_id: FAB2, req_kgs: 1000 }], [
    { item_id: FAB2, stage_id: null, process_id: "knit", loss_pct: 10 },
  ])),
  1666.667,
);

// §7 — an unweighed line POISONS its fabric, and the refusal names the fix.
const poisoned = iwoFabricGross([{ item_id: FAB, req_kgs: 500 }, { item_id: FAB, req_kgs: null }], KG, name);
check("§7 an unweighed line nulls the fabric's gross", poisoned.map((g) => g.gross), [null]);
check("§7 …and says which fabric to weigh", poisoned[0].refusal, "Enter the Req Wt for SINGLE JERSEY on Fabric Consumption.");

// §8 — no KGS row: refuse, never guess a unit.
check(
  "§8 no KGS unit refuses by name",
  iwoFabricGross([{ item_id: FAB, req_kgs: 1000 }], null, name)[0].refusal,
  "The UOM master has no active KGS row, so no yarn weight can be stated.",
);

// §9 — a step with no process is not a step (the order route's rule).
check(
  "§9 a route row naming no process is ignored",
  iwoRoutesByFabric([{ item_id: FAB, stage_id: "grey", process_id: null, loss_pct: 50 }], noKinds).size,
  0,
);

// ---------------------------------------------------------------------------
// FOR = YARN (step 4) — the yarn is picked and weighed; its own stages gross it
// ---------------------------------------------------------------------------

const ym = (planned: number | null, losses: (number | null)[], kg: string | null = KG) => {
  const w = iwoYarnModePurchase(planned, losses.map((loss_pct) => ({ loss_pct })), kg, 3, "30'S COTTON");
  return isRefusal(w) ? w : r3(w.qty);
};
check("§10 no stages: purchase = planned", ym(1000, []), 1000);
check("§10 a 10% dyeing stage DIVIDES: 1000 → 1111.112", ym(1000, [10]), 1111.112);
refute("§10 …and never 1100", ym(1000, [10]), 1100);
check("§10 two stages compound (3% then 2%)", ym(1000, [3, 2]), r3(Math.ceil((1000 / 0.97 / 0.98) * 1000) / 1000));
check("§10 no Planned Weight refuses, naming the yarn", ym(null, [10]), {
  refused: "Enter the Planned Weight for 30'S COTTON on Yarn Lines.",
});
check("§10 no KGS unit refuses", ym(1000, [], null), {
  refused: "The UOM master has no active KGS row, so no yarn weight can be stated.",
});

check(
  "§11 a blank yarn line is dropped, and an empty plan is refused",
  iwoYarnLineProblems([{ item_id: null, buy_stage_id: null, planned_kgs: null }]).map((p) => p.message),
  ["Add at least one yarn."],
);
check(
  "§11 a kept line owes its stage and its weight",
  iwoYarnLineProblems([{ item_id: COTTON, buy_stage_id: null, planned_kgs: null }]).map((p) => p.message),
  ["Yarn line 1: choose the stage it is bought in.", "Yarn line 1: enter the Planned Weight (KGS)."],
);
check(
  "§11 a yarn listed twice is refused by row",
  iwoYarnLineProblems([
    { item_id: COTTON, buy_stage_id: "grey", planned_kgs: 100 },
    { item_id: COTTON, buy_stage_id: "dyed", planned_kgs: 50 },
  ]).map((p) => p.message),
  ["Yarn line 2: this yarn is already on line 1 — plan it once."],
);
check(
  "§11 a line with only its stages typed is NOT blank",
  keptIwoYarnLines([{ item_id: null, buy_stage_id: null, planned_kgs: null, hasStages: true }]).length,
  1,
);

if (failed) {
  console.error(`\n${failed} IWO Fabric BOM vector(s) failed.`);
  process.exit(1);
}
console.log("\nIWO Fabric BOM: the typed weight reaches the order engine intact.");
