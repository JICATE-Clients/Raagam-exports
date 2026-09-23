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
import { iwoFabricGross, iwoRoutesByFabric, iwoYarnModePurchase, iwoYarnShades } from "../lib/orders/iwo-fabric-bom/yarn.ts";
import {
  cellKey,
  addPlanRow,
  derivePlanRows,
  expandPlanCells,
  familyDias,
  foldPlanCells,
  isPlaceholderFacts,
  planCellsForStage,
  plannedColours,
  planReqKgs,
  removePlanRow,
  SEED_ROW_KEY,
  setPlanCell,
  stalePlanRows,
  type PlanAxes,
  type PlanCells,
} from "../lib/orders/iwo-fabric-bom/plan.ts";
import {
  iwoFabricLineProblems,
  iwoFabricStages,
  iwoGreigeRouteProblems,
  iwoShadeTotal,
  iwoYarnLineProblems,
  keptIwoYarnLines,
} from "../lib/orders/iwo-fabric-bom/lines.ts";

import { readFileSync } from "node:fs";

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
  // 0592: with no Stage the line cannot know whether it owes a weight (GREY)
  // or shades (DYED), so it asks for the Stage alone.
  "§11 a kept line with no Stage is asked for the Stage first",
  iwoYarnLineProblems([{ item_id: COTTON, buy_stage_id: null, planned_kgs: null }]).map((p) => p.message),
  ["Yarn line 1: choose the Stage (GREY or DYED)."],
);
check(
  "§11 a GREY line owes its weight",
  iwoYarnLineProblems([{ item_id: COTTON, buy_stage_id: "grey", planned_kgs: null }]).map((p) => p.message),
  ["Yarn line 1: enter the Planned Weight (KGS)."],
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

// ---------------------------------------------------------------------------
// §12 SHADES (0592, client audio 2026-09-19): GREY = one weight, no colour;
// DYED = shades, and Colour by Dyed Purchase (each shade bought) or Yarn
// Dyeing (the grey total bought once, dyed by a step that covers every shade —
// 0613; 0592's "a dyeing step per shade" is history, see §16).
// ---------------------------------------------------------------------------

const ctx = { isDyedStage: (id: string) => id === "dyed", yarnColours: ["NAVY", "Black "] };
const msgs = (l: Parameters<typeof iwoYarnLineProblems>[0][number]) =>
  iwoYarnLineProblems([l], ctx).map((p) => p.message);
const navy = { color_name: "navy", planned_kgs: 250 };
const black = { color_name: "BLACK", planned_kgs: 100 };
const dye = (combo: string | null) => ({ combo, dyeing: true });

check("§12 a GREY line with a weight is clean", msgs({ item_id: COTTON, buy_stage_id: "grey", planned_kgs: 1000 }), []);
check(
  "§12 GREY takes no shades",
  msgs({ item_id: COTTON, buy_stage_id: "grey", planned_kgs: 1000, shades: [navy] }),
  ["Yarn line 1: a GREY yarn has no shades — clear them, or set the Stage to DYED."],
);
check(
  "§12 GREY takes no dyeing step — dyeing is what DYED means",
  msgs({ item_id: COTTON, buy_stage_id: "grey", planned_kgs: 1000, steps: [dye(null)] }),
  ["Yarn line 1: dyeing makes this yarn DYED — set its Stage to DYED and add the shades."],
);
check(
  "§12 GREY takes no step scoped to a colour",
  msgs({ item_id: COTTON, buy_stage_id: "grey", planned_kgs: 1000, steps: [{ combo: "NAVY", dyeing: false }] }),
  ["Yarn line 1: a GREY yarn is one lot — clear the For colour on its Yarn Process step."],
);
check(
  "§12 DYED owes Colour by and its shades — no Planned Weight asked",
  msgs({ item_id: COTTON, buy_stage_id: "dyed", planned_kgs: null }),
  ["Yarn line 1: choose Colour by — Dyed Purchase or Yarn Dyeing.", "Yarn line 1: add the shades and the KGS of each ([Shades])."],
);
check(
  "§12 a shade must be on the Yarn Colour panel, once, with KGS",
  msgs({
    item_id: COTTON,
    buy_stage_id: "dyed",
    planned_kgs: null,
    colour_by: "dyed_purchase",
    shades: [navy, { color_name: "RED", planned_kgs: 5 }, { color_name: "NAVY", planned_kgs: 0 }, { color_name: null, planned_kgs: null }],
  }),
  [
    "Yarn line 1: shade 2: RED is not on the Yarn Colour panel — add it there first.",
    "Yarn line 1: shade 3: NAVY is listed twice — plan it once.",
    "Yarn line 1: shade 3: KGS must be a number more than 0.",
  ],
);
check(
  "§12 Dyed Purchase: bought dyed, so no dyeing step",
  msgs({ item_id: COTTON, buy_stage_id: "dyed", planned_kgs: null, colour_by: "dyed_purchase", shades: [navy], steps: [dye("NAVY")] }),
  ["Yarn line 1: it is bought already dyed — remove the dyeing step, or choose Colour by Yarn Dyeing."],
);
check(
  "§12 Yarn Dyeing: a shade no dyeing step covers is named (a 0592 row scoped to NAVY leaves BLACK undyed)",
  msgs({ item_id: COTTON, buy_stage_id: "dyed", planned_kgs: null, colour_by: "yarn_dyeing", shades: [navy, black], steps: [dye("NAVY")] }),
  ["Yarn line 1: add a Yarn Dyeing step on Yarn Process — it dyes every shade (BLACK has none); For = Color Wise gives each shade its own loss %."],
);
check(
  "§12 Yarn Dyeing: no dyeing step at all names every shade",
  msgs({ item_id: COTTON, buy_stage_id: "dyed", planned_kgs: null, colour_by: "yarn_dyeing", shades: [navy, black], steps: [] }),
  ["Yarn line 1: add a Yarn Dyeing step on Yarn Process — it dyes every shade (NAVY, BLACK have none); For = Color Wise gives each shade its own loss %."],
);
check(
  "§12 Yarn Dyeing: ONE dyeing step For every shade is the answer (0613), not a refusal",
  msgs({ item_id: COTTON, buy_stage_id: "dyed", planned_kgs: null, colour_by: "yarn_dyeing", shades: [navy, black], steps: [dye(null)] }),
  [],
);
refute(
  "§12 …and 0592's 'one dyeing step per shade' sentence is gone — there is no cell to satisfy it in",
  msgs({ item_id: COTTON, buy_stage_id: "dyed", planned_kgs: null, colour_by: "yarn_dyeing", shades: [navy], steps: [dye(null), dye("NAVY")] }),
  ["Yarn line 1: choose which shade each dyeing step is For — one dyeing step per shade."],
);
check(
  "§12 a step For a colour that is not a shade is refused",
  msgs({
    item_id: COTTON,
    buy_stage_id: "dyed",
    planned_kgs: null,
    colour_by: "yarn_dyeing",
    shades: [navy],
    steps: [dye("NAVY"), { combo: "BLACK", dyeing: false }],
  }),
  ["Yarn line 1: a Yarn Process step is For BLACK, which is not a shade of this yarn."],
);
check(
  "§12 a correct Yarn Dyeing line is clean",
  msgs({
    item_id: COTTON,
    buy_stage_id: "dyed",
    planned_kgs: null,
    colour_by: "yarn_dyeing",
    shades: [navy, black],
    steps: [dye("NAVY"), dye("BLACK"), { combo: null, dyeing: false }],
  }),
  [],
);
check("§12 the Planned Weight of a DYED line is Σ shades", iwoShadeTotal([navy, black, { color_name: "", planned_kgs: null }]), 350);
check("§12 …and blank while a shade has no number", iwoShadeTotal([navy, { color_name: "BLACK", planned_kgs: null }]), null);

// The arithmetic. The SRS's own example, re-read by the audio: 250 KG of NAVY
// elastane by Yarn Dyeing at 10% dye loss. The grey bought is 250 / 0.9.
const shaded = (
  colourBy: "dyed_purchase" | "yarn_dyeing",
  shades: { color_name: string; planned_kgs: number | null }[],
  stages: { combo: string | null; loss_pct: number }[],
) => iwoYarnModePurchase(null, stages, KG, 3, "70D ELASTANE", { colourBy, shades });

const srs = shaded("yarn_dyeing", [{ color_name: "NAVY", planned_kgs: 250 }], [{ combo: "NAVY", loss_pct: 10 }]);
check("§12 SRS: 250 KG NAVY @ 10% → 277.778 grey bought", isRefusal(srs) ? srs : srs.qty, 277.778);
refute("§12 …never 275 (the ×(1+L) reading)", isRefusal(srs) ? srs : srs.qty, 275);

// Two shades, each dyed at 10%: 100/0.9 = 111.1111…, twice = 222.2222…
// Yarn Dyeing buys ONE grey lot and rounds it once → 222.223.
// Dyed Purchase buys each shade and rounds each → 111.112 × 2 = 222.224.
const two = [
  { color_name: "NAVY", planned_kgs: 100 },
  { color_name: "BLACK", planned_kgs: 100 },
];
const twoSteps = [
  { combo: "NAVY", loss_pct: 10 },
  { combo: "BLACK", loss_pct: 10 },
];
const yd = shaded("yarn_dyeing", two, twoSteps);
const dp = shaded("dyed_purchase", two, twoSteps);
check("§12 Yarn Dyeing rounds the grey lot ONCE", isRefusal(yd) ? yd : yd.qty, 222.223);
check("§12 Dyed Purchase rounds EACH shade", isRefusal(dp) ? dp : dp.qty, 222.224);
check("§12 …and says what each shade buys", isRefusal(dp) ? dp : dp.shadeQty, { NAVY: 111.112, BLACK: 111.112 });
check("§12 Yarn Dyeing carries no per-shade purchase", isRefusal(yd) ? yd : yd.shadeQty, undefined);

// A step For NAVY grosses NAVY only; an uncoloured step grosses every shade.
const scoped = shaded(
  "yarn_dyeing",
  two,
  [
    { combo: "NAVY", loss_pct: 10 },
    { combo: null, loss_pct: 2 },
  ],
);
check(
  "§12 each shade is its own bucket, grossed by the steps that cover it",
  isRefusal(scoped) ? scoped : scoped.byCombo.map((c) => [c.combo, r3(c.gross)]),
  [
    ["NAVY", r3(100 / 0.9 / 0.98)],
    ["BLACK", r3(100 / 0.98)],
  ],
);
check(
  "§12 Colour by missing refuses by name",
  iwoYarnModePurchase(null, [], KG, 3, "70D ELASTANE", { colourBy: null, shades: two }),
  { refused: "Choose how 70D ELASTANE is coloured (Colour by) on Yarn Lines." },
);

// ---------------------------------------------------------------------------
// §13 FABRIC STAGE, COLOUR, DIA (Phase 2, client audio 2026-09-19): GREIGE has
// no colour and its route stops at Greige; a coloured stage owes its Colour;
// one Stage per fabric; one line per (fabric, colour, dia).
// ---------------------------------------------------------------------------

const GREIGE = "st-greige";
const DYED = "st-dyed";
const rank = (id: string) => (id === GREIGE ? 0 : id === DYED ? 1 : null);
const fl = (over: Partial<Parameters<typeof iwoFabricLineProblems>[0][number]>) => ({
  structure_id: null,
  item_id: FAB,
  color_name: null,
  fabric_form: null,
  mixing_uom_id: null,
  no_of_colors: null,
  gsm: null,
  finish_dia: null,
  stage_id: GREIGE,
  req_kgs: 1000,
  ...over,
});
const fmsgs = (ls: ReturnType<typeof fl>[]) => iwoFabricLineProblems(ls, () => null, rank).map((p) => p.message);

check("§13 a GREIGE line with no colour is clean", fmsgs([fl({})]), []);
check(
  "§13 GREIGE carries no colour",
  fmsgs([fl({ color_name: "NAVY" })]),
  ["Fabric line 1: a GREIGE line has no colour — clear it (greige is one lot, dyed later)."],
);
check(
  // (A DYED line also owes its Finish Dia since the 2026-09-20 ticket — given
  //  here so this vector keeps testing the Colour alone.)
  "§13 a DYED line owes its Colour",
  fmsgs([fl({ stage_id: DYED, finish_dia: "24" })]),
  ["Fabric line 1: choose the Colour — a dyed line is planned per colour."],
);
check(
  "§13 two colours of one DYED fabric are two lines — allowed",
  fmsgs([fl({ stage_id: DYED, color_name: "NAVY", finish_dia: "24" }), fl({ stage_id: DYED, color_name: "BLACK", finish_dia: "24" })]),
  [],
);
check(
  "§13 multi-dia: one fabric at two dias is two lines — allowed",
  fmsgs([fl({ finish_dia: "24" }), fl({ finish_dia: "30" })]),
  [],
);
check(
  "§13 the same fabric, colour and dia twice is refused (merge it)",
  fmsgs([fl({ finish_dia: "24" }), fl({ finish_dia: " 24 " })]),
  ["Fabric line 2: the same fabric, colour and dia are on line 1 — put the weight on one line."],
);
check(
  "§13 two GREIGE lines with no dia are one lot — refused (the consolidation rule)",
  fmsgs([fl({}), fl({ req_kgs: 500 })]),
  ["Fabric line 2: the same fabric, colour and dia are on line 1 — put the weight on one line."],
);
check(
  "§13 one Stage per fabric",
  fmsgs([fl({ finish_dia: "24" }), fl({ stage_id: DYED, color_name: "NAVY", finish_dia: "30" })]),
  [
    "Fabric line 2: this fabric is at a different Stage on line 1 — one Stage per fabric (its Fabric Process route is shared).",
  ],
);
check("§13 an unrecognised stage asks nothing more", fmsgs([fl({ stage_id: "st-other", color_name: "NAVY" })]), []);

const routeNames = { fabric: () => "SINGLE JERSEY", stage: (id: string) => (id === DYED ? "DYED" : "GREIGE") };
const greigeOf = new Map([[FAB, GREIGE]]);
check(
  "§13 a GREIGE fabric may knit (a Greige step)",
  iwoGreigeRouteProblems([{ item_id: FAB, stage_id: GREIGE, process_id: "knit" }], greigeOf, rank, routeNames),
  [],
);
check(
  "§13 a GREIGE fabric may not be dyed — its route stops at Greige",
  iwoGreigeRouteProblems(
    [
      { item_id: FAB, stage_id: GREIGE, process_id: "knit" },
      { item_id: FAB, stage_id: DYED, process_id: "dye" },
    ],
    greigeOf,
    rank,
    routeNames,
  ).map((p) => p.message),
  ["SINGLE JERSEY is planned GREIGE, so its route stops at Greige — remove the DYED step, or plan the fabric in that stage."],
);
check(
  "§13 a DYED fabric's route may pass through DYED",
  iwoGreigeRouteProblems([{ item_id: FAB, stage_id: DYED, process_id: "dye" }], new Map([[FAB, DYED]]), rank, routeNames),
  [],
);
check(
  "§13 a step naming no process is not judged",
  iwoGreigeRouteProblems([{ item_id: FAB, stage_id: DYED, process_id: null }], greigeOf, rank, routeNames),
  [],
);
check(
  "§13 each fabric's Stage is its first kept line's",
  [...iwoFabricStages([fl({ item_id: null, stage_id: null, req_kgs: null }), fl({ stage_id: DYED }), fl({ stage_id: GREIGE })])],
  [[FAB, DYED]],
);

// ---------------------------------------------------------------------------
// §14 COLOUR × DIA × PRINT (client ticket 2026-09-20, §2–§4) and the per-colour
// gross the Details popup's yarn-dyed losses are matched against.
// ---------------------------------------------------------------------------
const PRINT = "st-print";
const rank14 = (id: string) => (id === GREIGE ? 0 : id === DYED ? 1 : id === PRINT ? 2 : null);
const f14 = (ls: ReturnType<typeof fl>[]) => iwoFabricLineProblems(ls, () => null, rank14).map((p) => p.message);
check(
  "§14 a DYED line owes its Finish Dia (Colour × Dia)",
  f14([fl({ stage_id: DYED, color_name: "RED" })]),
  ["Fabric line 1: choose the Finish Dia — a dyed or printed line is planned per colour and dia."],
);
check("§14 GREIGE: several dias of one fabric, each its own weight — allowed", f14([fl({ finish_dia: "24" }), fl({ finish_dia: "26" }), fl({ finish_dia: "28" })]), []);
check(
  "§14 a PRINTED line owes its Print, Colour and Dia",
  f14([fl({ stage_id: PRINT })]),
  [
    "Fabric line 1: choose the Colour — a dyed line is planned per colour.",
    "Fabric line 1: choose the Finish Dia — a dyed or printed line is planned per colour and dia.",
    "Fabric line 1: choose the Print — a printed line is planned per print, colour and dia.",
  ],
);
check(
  "§14 two prints of one fabric at one colour and dia are two lines — allowed",
  f14([
    fl({ stage_id: PRINT, color_name: "WHITE", finish_dia: "30", print_name: "FLORAL" }),
    fl({ stage_id: PRINT, color_name: "WHITE", finish_dia: "30", print_name: "PAISLEY" }),
  ]),
  [],
);
check(
  "§14 …the same print twice is refused",
  f14([
    fl({ stage_id: PRINT, color_name: "WHITE", finish_dia: "30", print_name: "FLORAL" }),
    fl({ stage_id: PRINT, color_name: "WHITE", finish_dia: "30", print_name: "floral " }),
  ]),
  ["Fabric line 2: the same fabric, colour, dia and print are on line 1 — put the weight on one line."],
);
check(
  "§14 a Print on a line not in a print stage is refused",
  f14([fl({ stage_id: DYED, color_name: "RED", finish_dia: "24", print_name: "FLORAL" })]),
  ["Fabric line 1: only a line in a Print stage carries a Print — clear it, or set the Stage to PRINT."],
);
check(
  "§14 the gross is split PER COLOUR (the Details popup's shades key on it); dias of one colour sum",
  iwoFabricGross(
    [
      { item_id: FAB, req_kgs: 600, color_name: "red" },
      { item_id: FAB, req_kgs: 400, color_name: "RED" },
      { item_id: FAB, req_kgs: 500, color_name: "NAVY" },
    ],
    KG,
    name,
  ).map((g) => [g.combo, g.gross]),
  [
    ["RED", 1000],
    ["NAVY", 500],
  ],
);
{
  const split = yarnPurchase(
    COTTON,
    iwoFabricGross(
      [
        { item_id: FAB, req_kgs: 1000, color_name: "RED" },
        { item_id: FAB, req_kgs: 500, color_name: "NAVY" },
      ],
      KG,
      name,
    ),
    comps,
    new Map(),
    [],
    3,
    new Map(),
    [],
  );
  check("§14 …and a solid cloth's yarn is unchanged by the split", [qty(buy(COTTON, [{ item_id: FAB, req_kgs: 1500 }], [])), qty(split)], [1500, 1500]);
  const dyed = yarnPurchase(
    COTTON,
    iwoFabricGross(
      [
        { item_id: FAB, req_kgs: 950, color_name: "RED" },
        { item_id: FAB, req_kgs: 500, color_name: "NAVY" },
      ],
      KG,
      name,
    ),
    comps,
    new Map(),
    [],
    3,
    new Map(),
    [
      { fabric_id: FAB, yarn_id: COTTON, combo: "RED", share: 1, loss_pct: 5 },
      { fabric_id: FAB, yarn_id: COTTON, combo: "NAVY", share: 1, loss_pct: 0 },
    ],
  );
  check("§14 a Yarn Dyed shade's loss grosses ITS colour only (RED 950 @ 5% → 1000, NAVY 500)", qty(dyed), 1500);
}

{
  // The Details popup's Yarn Dyed rows → shades: 60/40 stripes of cotton, a
  // 5% loss on RED's first stripe only. Colour typed lower-case, padded — the
  // shade must still key on the "RED" bucket `iwoFabricGross` makes.
  const rep = (sno: number, value: number, item_id = FAB) => ({
    item_id, sno, yarn_item_id: COTTON, dye_type: "dyed" as const, color_name: null, uom_id: null, value, twisted_yarn: null,
  });
  check(
    "§14 iwoYarnShades: each colour × stripe is one shade, loss by stripe POSITION",
    iwoYarnShades(
      [rep(1, 60), rep(2, 40)],
      [
        { item_id: FAB, combo: "red ", yd_combo_name: null, colors: [{ sno: 1, dyeing_loss_pct: 5 }, { sno: 2, dyeing_loss_pct: null }] },
        { item_id: FAB, combo: "NAVY", yd_combo_name: null, colors: [] },
      ],
      comps,
    ).map((x) => [x.fabric_id, x.combo, x.share, x.loss_pct]),
    [
      [FAB, "RED", 0.6, 5],
      [FAB, "RED", 0.4, 0],
      [FAB, "NAVY", 0.6, 0],
      [FAB, "NAVY", 0.4, 0],
    ],
  );
  check("§14 …a fabric with repeats but no combination has no shades", iwoYarnShades([rep(1, 100)], [], comps), []);
  // A BLANK REPEAT TAKES NO STRIPE POSITION: the save drops it, so the shades
  // must too, or RED's 5% would land on the stripe after it.
  const blank = { ...rep(2, 0), value: null, yarn_item_id: null };
  check(
    "§14 …a blank repeat between two stripes is not a position (the save drops it)",
    iwoYarnShades(
      [rep(1, 60), blank, rep(3, 40)],
      [{ item_id: FAB, combo: "RED", yd_combo_name: null, colors: [{ sno: 1, dyeing_loss_pct: 0 }, { sno: 2, dyeing_loss_pct: 5 }] }],
      comps,
    ).map((x) => [x.share, x.loss_pct]),
    [
      [0.6, 0],
      [0.4, 5],
    ],
  );
}

// ---------------------------------------------------------------------------
// §15 THE REFUSAL MUST BE SATISFIABLE (client 2026-09-20), TAKE TWO (0613)
//
// The first cut of this section pinned that the grid's Colour cell was drawn
// for a dyeing step that owed a shade (`owesCombo`), because 0592's rule
// demanded a shade per dyeing step and the cell it lived in was hidden. 0613
// removed the cell altogether — the IWO now has the Fabric BOM's shape, where
// For = COLOR WISE turns the Loss % into a [Color Loss] list — so the same
// principle now reads the other way round: the SCREEN must pass `colourLoss`
// (so COLOR WISE opens the list, not a shade ▾ — client screenshot 2979) and
// the RULE must not demand a shade on the step (§12 above proves the rule;
// this proves the wiring, which the arithmetic vectors cannot see).
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const screenSrc = read("../app/(app)/orders/iwo-fabric-bom/iwo-fabric-bom-screen.tsx");
const rulesSrc = read("../lib/orders/iwo-fabric-bom/lines.ts");

check(
  "§15 the IWO screen gives YarnProcessGrid the Fabric BOM's colour-wise shape",
  /<YarnProcessGrid[\s\S]{0,1200}?\bcolourLoss\b/.test(screenSrc),
  true,
);
check(
  "§15 …and FabricProcessGrid the line Colours to list",
  /<FabricProcessGrid[\s\S]{0,2500}?lossColours=\{/.test(screenSrc),
  true,
);
check("§15 …and no longer tells the grid which steps owe a shade (the cell is gone)", /owesCombo/.test(screenSrc), false);
check(
  "§15 the rule no longer demands a shade per dyeing step",
  /one dyeing step per shade\./.test(rulesSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
  false,
);
check(
  "§15 the shades are still offered from the line, known before the weight is",
  /const combos = line[\s\S]{0,200}?keptIwoYarnShades/.test(screenSrc),
  true,
);

// ---------------------------------------------------------------------------
// §16 COLOUR-WISE LOSS ON AN IWO (0613; the order's 0606). One dyeing step
// For every shade carries a loss per shade; each shade's bucket is grossed
// by ITS figure, a shade not listed by the step's flat loss. Nothing in
// `yarn.ts` branches on it — the map rides through to `stagesForGroup`.
// ---------------------------------------------------------------------------

const wise = shaded(
  "yarn_dyeing",
  two,
  [{ combo: null, loss_pct: 10, color_losses: { NAVY: 10, BLACK: 5 } } as never],
);
check(
  "§16 NAVY at 10%, BLACK at 5% — one step, two figures",
  isRefusal(wise) ? wise : wise.byCombo.map((c) => [c.combo, r3(c.gross)]),
  [
    ["NAVY", r3(100 / 0.9)],
    ["BLACK", r3(100 / 0.95)],
  ],
);
refute(
  "§16 …and NOT both at the flat 10%",
  isRefusal(wise) ? wise : wise.byCombo.map((c) => r3(c.gross)),
  [r3(100 / 0.9), r3(100 / 0.9)],
);
const partial = shaded("yarn_dyeing", two, [{ combo: null, loss_pct: 10, color_losses: { BLACK: 5 } } as never]);
check(
  "§16 a shade the map does not list pays the step's flat loss",
  isRefusal(partial) ? partial : partial.byCombo.map((c) => [c.combo, r3(c.gross)]),
  [
    ["NAVY", r3(100 / 0.9)],
    ["BLACK", r3(100 / 0.95)],
  ],
);
check(
  "§16 the grey lot is Σ shades at their own losses, rounded once",
  isRefusal(wise) ? wise : wise.qty,
  Math.ceil((100 / 0.9 + 100 / 0.95) * 1000) / 1000,
);
// For = Fabric: a COLOR WISE route step grosses each line Colour by its own
// figure — the line's Colour is the bucket (`iwoFabricGross`).
const twoColours = [
  { item_id: FAB, req_kgs: 100, color_name: "NAVY" },
  { item_id: FAB, req_kgs: 100, color_name: "WHITE" },
];
const routeWise = iwoRoutesByFabric(
  [{ item_id: FAB, stage_id: "st-dyed", process_id: "p-dye", loss_pct: 10, color_losses: { NAVY: 10, WHITE: 2 } }],
  noKinds,
);
const fabWise = yarnPurchase(COTTON, iwoFabricGross(twoColours, KG, name), comps, routeWise, [], 3, new Map(), []);
check(
  "§16 Fabric IWO: NAVY cloth at 10%, WHITE at 2%, through one COLOR WISE step",
  isRefusal(fabWise) ? fabWise : fabWise.byCombo.map((c) => [c.combo, r3(c.gross)]),
  // Each bucket rounds UP to the unit's 3dp, `yarnPurchase`'s own rule.
  [
    ["NAVY", Math.ceil((100 / 0.9) * 1000) / 1000],
    ["WHITE", Math.ceil((100 / 0.98) * 1000) / 1000],
  ],
);

// ---------------------------------------------------------------------------
// §17 FINISH DIA OF THE FABRIC'S OWN FAMILY (client 2026-09-19) — the order
// screen's rule, applied to the IWO on 2026-09-21. `dia-knit.ts` is the rule
// (vectored on the order side); these pin that the IWO copy READS it: the
// picker is scoped by the line's family, the one-dia prefill counts within
// that family, and the Save gate + the action both refuse the wrong family.
// ---------------------------------------------------------------------------

const actionSrc = read("../lib/orders/iwo-fabric-bom/actions.ts");
// Since 2026-09-22 the dias are DERIVED per card (§18), so "scoped by the
// family" is `familyDias(diaDeclarations, lineKnitCode(l))` feeding the axes
// — there is no picker to scope and no prefill to count.
check("§17 the card's dias are the line's family's (`familyDias`)", /dias: familyDias\(diaDeclarations, lineKnitCode\(l\)\)/.test(screenSrc), true);
// ONE ROW PER FABRIC (client 2026-09-21): `+ Dia` inserted a second LINE of the
// same fabric, so the fabric showed twice. The cells now live on the row and are
// expanded to one stored line each at the boundary — `expandLine`.
check("§17 `+ Dia` no longer inserts a second line of the fabric", /addLineLike/.test(screenSrc), false);
check("§17 …the payload, the rules and the engine read the EXPANDED lines", (screenSrc.match(/expandLines\(lines\)/g) ?? []).length >= 3, true);
check("§17 the screen's Save gate refuses a wrong-family dia", /diaKnitBlockers\.map/.test(screenSrc), true);
check("§17 …and so does the action, with the same sentence", /diaKnitProblem\(l\.finish_dia, knitOf\.get/.test(actionSrc), true);

// ---------------------------------------------------------------------------
// §18 DERIVED CONSUMPTION ROWS (user 2026-09-22, screenshot 3000) — one card
// per fabric, its rows = Fabric Colour × family dia (× print on PRINT), the
// operator types only the weight; `plan.ts` is the boundary to 0592's one
// stored line per (fabric, colour, dia, print). These prove: the derivation
// (order, axes per stage), a weight surviving as "not declared" when its
// panel row goes, blank = not stored, an EMPTY card expanding to ONE
// placeholder the existing weight rule refuses (never to nothing, which would
// drop the fabric), fold ∘ expand = identity both ways, and the Stage merges
// that never throw a weight away. Each was made to FAIL first by mutating the
// rule (dia-major order, `[]` for the empty card, a dropped stale cell, a
// raw-cased key, an untyped dia offered to a typed fabric).
// ---------------------------------------------------------------------------

const AX_DYED: PlanAxes = { rank: 1, colours: ["WHITE", "RED"], dias: ["74", "76"], prints: [] };
const AX_PRINT: PlanAxes = { ...AX_DYED, rank: 2, prints: ["AOP"] };
const AX_GREIGE: PlanAxes = { rank: 0, colours: ["WHITE", "RED"], dias: ["74", "76"], prints: [] };
const keysOf = (cells: PlanCells, axes: PlanAxes) => derivePlanRows(cells, axes).map((r) => [r.color_name, r.finish_dia, r.print_name, r.req_kgs, r.declared]);
const K = (c: string, d: string, p = "") => cellKey(c, d, p);
const cells = (...xs: [string, string, string, string][]): PlanCells =>
  Object.fromEntries(xs.map(([c, d, p, kg]) => [K(c, d, p), { color_name: c, finish_dia: d, print_name: p, req_kgs: kg }]));

// NO DERIVATION (user, 2026-09-23: "in fabric consumption there is one error,
// the dia auto derivation"). The card was a colour × EVERY family dia cross
// product; now it is the rows the operator adds, each axis a picker.
const SEEDED: unknown[] = ["", "", "", "", true];
check("§18 DYED, nothing typed: ONE seeded blank row — never colour × dia", keysOf({}, AX_DYED), [SEEDED]);
check("§18 PRINT: still one blank row (no × prints)", keysOf({}, AX_PRINT), [SEEDED]);
check("§18 GREIGE: one blank row, no dia pre-filled", keysOf({}, AX_GREIGE), [SEEDED]);
check("§18 EXACTLY ONE dia declared is STILL not pre-filled", keysOf({}, { ...AX_DYED, dias: ["74"] }), [SEEDED]);
check("§18 no Stage yet: the blank row, declared (the Stage's hold speaks)", keysOf({}, { ...AX_DYED, rank: null }), [SEEDED]);
check("§18 rows come back in the order they were added", keysOf(cells(["RED", "76", "", "5"], ["WHITE", "74", "", "400"]), AX_DYED), [
  ["RED", "76", "", "5", true], ["WHITE", "74", "", "400", true],
]);
check("§18 a colour the panel no longer names is KEPT, tagged", keysOf(cells(["BLUE", "74", "", "5"]), AX_DYED)[0], ["BLUE", "74", "", "5", false]);
check("§18 a dia outside the family is tagged", keysOf(cells(["WHITE", "99", "", "5"]), AX_DYED)[0], ["WHITE", "99", "", "5", false]);
check("§18 a blank axis is 'not chosen yet', not undeclared", keysOf(cells(["WHITE", "", "", ""]), AX_DYED)[0], ["WHITE", "", "", "", true]);
check("§18 stalePlanRows = the tagged ones", stalePlanRows(cells(["WHITE", "74", "", "400"], ["BLUE", "74", "", "5"]), AX_DYED).map((r) => r.color_name), ["BLUE"]);

// editing
const seed = derivePlanRows({}, AX_DYED)[0];
check("§18 the first pick materialises the SEEDED row under its own key", Object.keys(setPlanCell({}, seed, { finish_dia: "74" })), [SEED_ROW_KEY]);
check("§18 …holding only what was picked", setPlanCell({}, seed, { finish_dia: "74" })[SEED_ROW_KEY], { color_name: "", finish_dia: "74", print_name: "", req_kgs: "" });
check("§18 re-picking the dia keeps the row's key (the cursor stays put)", Object.keys(setPlanCell(setPlanCell({}, seed, { finish_dia: "74" }), seed, { finish_dia: "76" })), [SEED_ROW_KEY]);
check("§18 + Add on an empty card keeps the seeded row and adds a second", Object.keys(addPlanRow({})), [SEED_ROW_KEY, "r1"]);
check("§18 + Add never reuses a held key", Object.keys(addPlanRow({ [SEED_ROW_KEY]: { color_name: "", finish_dia: "", print_name: "", req_kgs: "" }, r1: { color_name: "", finish_dia: "", print_name: "", req_kgs: "" } })).length, 3);
check("§18 ✕ removes the row", Object.keys(removePlanRow(addPlanRow({}), "r1")), [SEED_ROW_KEY]);
check("§18 ✕ on the last row leaves the seeded blank one", keysOf(removePlanRow(setPlanCell({}, seed, { finish_dia: "74" }), SEED_ROW_KEY), AX_DYED), [SEEDED]);

// the boundary
const stored = [
  { color_name: "WHITE", print_name: null, finish_dia: "74", req_kgs: 400 },
  { color_name: "WHITE", print_name: null, finish_dia: "76", req_kgs: 200 },
  { color_name: "RED", print_name: null, finish_dia: "74", req_kgs: 750 },
];
const facts = (c: PlanCells) => expandPlanCells(c).map((f) => [f.color_name, f.print_name, f.finish_dia, f.req_kgs]);
check("§18 expand: one fact per weighted cell", facts(cells(["WHITE", "74", "", "400"], ["RED", "74", "", "750"])), [["WHITE", null, "74", 400], ["RED", null, "74", 750]]);
check("§18 an EMPTY card expands to ONE placeholder — never to nothing", facts({}), [[null, null, null, null]]);
check("§18 …which the existing weight rule refuses FIRST", iwoFabricLineProblems(
  [{ structure_id: null, item_id: "f1", fabric_form: null, mixing_uom_id: null, no_of_colors: null, gsm: 180, stage_id: "dyed", ...expandPlanCells({})[0] }],
  () => null,
  () => 1,
)[0]?.field, "req_kgs");
check("§18 …and only the placeholder answers to `isPlaceholderFacts`", [isPlaceholderFacts(expandPlanCells({})[0]), isPlaceholderFacts(expandPlanCells(cells(["WHITE", "74", "", "x"]))[0])], [true, false]);
check("§18 fold ∘ expand = identity", expandPlanCells(foldPlanCells(stored)).map((f) => [f.color_name, f.print_name, f.finish_dia, f.req_kgs]), stored.map((f) => [f.color_name, f.print_name, f.finish_dia, f.req_kgs]));
check("§18 expand ∘ fold = identity (values, in order)", Object.values(foldPlanCells(expandPlanCells(cells(["WHITE", "74", "", "400"], ["RED", "76", "AOP", "1"])))), Object.values(cells(["WHITE", "74", "", "400"], ["RED", "76", "AOP", "1"])));
check("§18 a wholly blank row is not a line", facts(cells(["", "", "", ""], ["WHITE", "74", "", "400"])), [["WHITE", null, "74", 400]]);
check("§18 a row with a dia and NO weight is a real line, not the placeholder", [facts(cells(["WHITE", "74", "", ""])), isPlaceholderFacts(expandPlanCells(cells(["WHITE", "74", "", ""]))[0])], [[["WHITE", null, "74", null]], false]);
check("§18 fold skips a line with no weight", Object.keys(foldPlanCells([{ color_name: "WHITE", print_name: null, finish_dia: "74", req_kgs: null }])), []);
check("§18 a stored `white` / `74 ` keeps its spelling and derives as declared", keysOf(foldPlanCells([{ color_name: "white", print_name: null, finish_dia: "74 ", req_kgs: 400 }]), AX_DYED)[0], ["white", "74 ", "", "400", true]);

// the family
const decls = [{ knit_type: "circular", dia: "60" }, { knit_type: "woven", dia: "60" }, { knit_type: "woven", dia: "72" }, { knit_type: "", dia: "80" }];
check("§18 familyDias: circular 60 + woven 60 = one 60; an untyped dia is not offered to a typed fabric", familyDias(decls, "circular"), ["60"]);
check("§18 familyDias with no family: every declared dia, once", familyDias(decls, null), ["60", "72", "80"]);

// the Stage
const typed = cells(["WHITE", "74", "", "400"], ["RED", "74", "", "750"], ["WHITE", "76", "", "200"]);
check("§18 → GREIGE merges per dia and SUMS", planCellsForStage(typed, 0), cells(["", "74", "", "1150"], ["", "76", "", "200"]));
refute("§18 …never dropping a weight", planReqKgs(planCellsForStage(typed, 0)), null);
check("§18 off a Print stage the prints merge per colour · dia", planCellsForStage(cells(["WHITE", "74", "AOP", "1"], ["WHITE", "74", "DOT", "2"]), 1), cells(["WHITE", "74", "", "3"]));
check("§18 GREIGE → coloured is the identity", planCellsForStage(cells(["", "74", "", "5"]), 1), cells(["", "74", "", "5"]));

// the readers
check("§18 planReqKgs sums the cells", planReqKgs(typed), 1350);
check("§18 …null while nothing is typed", planReqKgs({}), null);
check("§18 …NaN passes (refused by name downstream)", Number.isNaN(planReqKgs(cells(["WHITE", "74", "", "x"]))), true);
check("§18 plannedColours — the gross buckets", plannedColours(typed), ["WHITE", "RED"]);

// the wiring
check("§18 a Stage change re-plans the cells", /planCellsForStage\(x\.cells, rank\)/.test(screenSrc), true);
check("§18 load folds each fabric's lines", /cells: foldPlanCells\(rs\)/.test(screenSrc), true);
check("§18 the Save gate refuses an undeclared weight", /staleBlockers\.map/.test(screenSrc), true);
check("§18 the attribute and the sheet are gone", /plan_by|openBreakup|FabricBreakupSheet/.test(screenSrc), false);

if (failed) {
  console.error(`\n${failed} IWO Fabric BOM vector(s) failed.`);
  process.exit(1);
}
console.log("\nIWO Fabric BOM: the typed weight reaches the order engine intact.");
