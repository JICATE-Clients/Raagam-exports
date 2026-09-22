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
  blankPlanRow,
  expandPlan,
  foldLines,
  planByFor,
  replan,
  replanForStage,
  reqKgsOf,
  type PlanLine,
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
check("§17 the IWO Finish Dia picker is scoped by the line's family", /diaOptionsFor\(r\.finish_dia, lineKnitCode\(r\)\)/.test(screenSrc), true);
check("§17 …and the [Breakup] sheet reads the SAME scoped list", /diaOptionsFor=\{\(held\) => diaOptionsFor\(held, breakupLine \? lineKnitCode\(breakupLine\)/.test(screenSrc), true);
// ONE ROW PER FABRIC (client 2026-09-21): `+ Dia` inserted a second LINE of the
// same fabric, so the fabric showed twice. The dias now live on the row and are
// expanded to one stored line each at the boundary — `expandLine`.
check("§17 `+ Dia` no longer inserts a second line of the fabric", /addLineLike/.test(screenSrc), false);
check("§17 …the payload, the rules and the engine read the EXPANDED lines", (screenSrc.match(/expandLines\(lines\)/g) ?? []).length >= 3, true);
check("§17 …and the one-dia prefill counts within that family", /defaultDiaFor\(lineKnitCode\(/.test(screenSrc), true);
check("§17 the screen's Save gate refuses a wrong-family dia", /diaKnitBlockers\.map/.test(screenSrc), true);
check("§17 …and so does the action, with the same sentence", /diaKnitProblem\(l\.finish_dia, knitOf\.get/.test(actionSrc), true);

// ---------------------------------------------------------------------------
// §18 PLAN BY (client 2026-09-21, screenshots 2990 · 2992) — the Material
// BOM's Attribute with a fabric's axes. ONE ROW PER FABRIC on screen, ONE
// STORED LINE PER (fabric, colour, dia) underneath: `plan.ts` is the boundary
// and these prove it — fold ∘ expand is identity, the greige re-plan merges
// per dia and SUMS (the user's decision: "greige is one lot"), a split with
// only a blank row still expands to ONE line the rules can refuse, Print
// rides on a row only where Colour is split, and inference picks the
// narrowest attribute. Each was made to FAIL first by mutating the rule.
// ---------------------------------------------------------------------------

let k = 0;
const nk = () => `k${++k}`;
const pl = (over: Partial<PlanLine>): PlanLine => ({ plan_by: "fabric", color_name: "", print_name: "", finish_dia: "", req_kgs: "", rows: [], ...over });
const facts = (l: PlanLine) => expandPlan(l).map((f) => [f.color_name, f.print_name, f.finish_dia, f.req_kgs]);

check("§18 Fabric: one line, all four off the row", facts(pl({ color_name: "WHITE", finish_dia: "74", req_kgs: "500" })), [["WHITE", null, "74", 500]]);
check(
  "§18 Colour + Dia: one line per row, colour and dia off the row",
  facts(pl({ plan_by: "colour_dia", rows: [
    { key: "a", color_name: "WHITE", print_name: "", dia: "74", req_kgs: "400" },
    { key: "b", color_name: "WHITE", print_name: "", dia: "76", req_kgs: "200" },
    { key: "c", color_name: "RED", print_name: "", dia: "74", req_kgs: "750" },
  ] })),
  [["WHITE", null, "74", 400], ["WHITE", null, "76", 200], ["RED", null, "74", 750]],
);
check(
  "§18 Colour only: the dia comes off the FABRIC row for every line",
  facts(pl({ plan_by: "colour", finish_dia: "74", rows: [
    { key: "a", color_name: "WHITE", print_name: "", dia: "", req_kgs: "400" },
    { key: "b", color_name: "RED", print_name: "", dia: "", req_kgs: "750" },
  ] })),
  [["WHITE", null, "74", 400], ["RED", null, "74", 750]],
);
check(
  "§18 Dia only: the colour (and print) come off the FABRIC row for every line",
  facts(pl({ plan_by: "dia", color_name: "WHITE", print_name: "AOP", rows: [
    { key: "a", color_name: "", print_name: "", dia: "74", req_kgs: "400" },
    { key: "b", color_name: "", print_name: "", dia: "76", req_kgs: "200" },
  ] })),
  [["WHITE", "AOP", "74", 400], ["WHITE", "AOP", "76", 200]],
);
check(
  "§18 Print rides on the ROW only where Colour is split",
  facts(pl({ plan_by: "colour_dia", print_name: "IGNORED", rows: [{ key: "a", color_name: "WHITE", print_name: "AOP", dia: "74", req_kgs: "1" }] })),
  [["WHITE", "AOP", "74", 1]],
);
check(
  "§18 a split with only a blank row expands to ONE refusable line, never to nothing",
  facts(pl({ plan_by: "colour_dia", rows: [blankPlanRow("a")] })),
  [[null, null, null, null]],
);
check(
  "§18 …and a blank row beside real rows is dropped",
  facts(pl({ plan_by: "colour_dia", rows: [{ key: "a", color_name: "WHITE", print_name: "", dia: "74", req_kgs: "1" }, blankPlanRow("b")] })).length,
  1,
);
check("§18 reqKgsOf: Fabric is the typed figure", reqKgsOf(pl({ req_kgs: "500" })), 500);
check("§18 reqKgsOf: a split is Σ rows", reqKgsOf(pl({ plan_by: "colour", rows: [
  { key: "a", color_name: "WHITE", print_name: "", dia: "", req_kgs: "400" },
  { key: "b", color_name: "RED", print_name: "", dia: "", req_kgs: "750.5" },
] })), 1150.5);
check("§18 reqKgsOf: NULL while no row carries a weight (so 'enter the Req Wt' still fires)", reqKgsOf(pl({ plan_by: "colour", rows: [blankPlanRow("a")] })), null);

// fold ∘ expand = identity, and the attribute is inferred from the lines
const stored = [
  { color_name: "WHITE", print_name: null, finish_dia: "74", req_kgs: 400 },
  { color_name: "WHITE", print_name: null, finish_dia: "76", req_kgs: 200 },
  { color_name: "RED", print_name: null, finish_dia: "74", req_kgs: 750 },
];
const folded = foldLines(stored, nk);
check("§18 fold: colours > 1 and dias > 1 → Colour + Dia", folded.plan_by, "colour_dia");
check("§18 fold ∘ expand = identity", expandPlan(folded), stored);
check("§18 fold: one line → Fabric, the cells on the row", (() => { const f = foldLines([stored[0]], nk); return [f.plan_by, f.color_name, f.finish_dia, f.req_kgs]; })(), ["fabric", "WHITE", "74", "400"]);
check("§18 fold: colours > 1, one dia → Colour, the dia on the row", (() => { const f = foldLines([stored[0], stored[2]], nk); return [f.plan_by, f.finish_dia, f.rows.map((r) => r.color_name)]; })(), ["colour", "74", ["WHITE", "RED"]]);
check("§18 fold: one colour, dias > 1 → Dia, the colour on the row", (() => { const f = foldLines([stored[0], stored[1]], nk); return [f.plan_by, f.color_name, f.rows.map((r) => r.dia)]; })(), ["dia", "WHITE", ["74", "76"]]);
check("§18 fold: greige lines (no colour) in two dias → Dia", foldLines([{ color_name: null, print_name: null, finish_dia: "34", req_kgs: 80 }, { color_name: null, print_name: null, finish_dia: "36", req_kgs: 40 }], nk).plan_by, "dia");

// switching the attribute keeps what was typed
const single = pl({ color_name: "WHITE", finish_dia: "74", req_kgs: "500", rows: [blankPlanRow("z")] });
check("§18 replan Fabric → Colour + Dia seeds the first row from the fabric row", replan(single, "colour_dia", nk).rows.map((r) => [r.color_name, r.dia, r.req_kgs]), [["WHITE", "74", "500"]]);
check("§18 replan Fabric → Colour keeps the dia ON the row (and, hidden, on the seed row)", (() => { const r = replan(single, "colour", nk); return [r.finish_dia, r.rows[0].color_name, r.rows[0].dia]; })(), ["74", "WHITE", "74"]);

// THE PATH IN SCREENSHOT 2993: Colour + Dia → Colour → Colour + Dia. The first
// cut cleared each row's dia on the way out and stamped one dia on every row
// on the way back, so WHITE 74 400 + WHITE 76 100 became WHITE 74 twice and
// the unique-triple rule refused a plan the operator had not typed.
const twoDias = pl({ plan_by: "colour_dia", rows: [
  { key: "a", color_name: "WHITE", print_name: "", dia: "74", req_kgs: "400" },
  { key: "b", color_name: "WHITE", print_name: "", dia: "76", req_kgs: "100" },
] });
const viaColour = replan(twoDias, "colour", nk);
check("§18 hiding the dia axis keeps each row's dia", viaColour.rows.map((r) => r.dia), ["74", "76"]);
check("§18 …the fabric row takes the first row's dia", viaColour.finish_dia, "74");
check("§18 …and the expansion MERGES rows that differ only on the hidden axis: WHITE 74 500, one line", facts(viaColour), [["WHITE", null, "74", 500]]);
check("§18 …so switching back restores the two rows exactly", facts(replan(viaColour, "colour_dia", nk)), facts(twoDias));
check(
  "§18 rows identical on EVERY axis are a true duplicate and stay two lines (refused by name)",
  facts(pl({ plan_by: "colour_dia", rows: [
    { key: "a", color_name: "WHITE", print_name: "", dia: "74", req_kgs: "400" },
    { key: "b", color_name: "WHITE", print_name: "", dia: "74", req_kgs: "100" },
  ] })).length,
  2,
);
check("§18 replan a split → Fabric copies the first row back and Σ as the figure", (() => { const r = replan(folded, "fabric", nk); return [r.color_name, r.finish_dia, r.req_kgs]; })(), ["WHITE", "74", "1350"]);
check("§18 replan Colour → Colour + Dia keeps every colour row and asks for its dia", (() => {
  const r = replan(pl({ plan_by: "colour", finish_dia: "74", rows: [{ key: "a", color_name: "WHITE", print_name: "", dia: "", req_kgs: "1" }, { key: "b", color_name: "RED", print_name: "", dia: "", req_kgs: "2" }] }), "colour_dia", nk);
  return r.rows.map((x) => [x.color_name, x.dia]);
})(), [["WHITE", "74"], ["RED", "74"]]);

// the Stage decides: what is offered, and what a change does to the plan
check("§18 GREIGE offers Fabric and Dia only", planByFor(0), ["fabric", "dia"]);
check("§18 a coloured stage offers all four", planByFor(1).length, 4);
check(
  "§18 → GREIGE merges colours per dia and SUMS (WHITE 400 + RED 750 in 74\" = 1150), Plan by becomes Dia",
  (() => { const r = replanForStage(folded, 0, nk); return [r.plan_by, r.rows.map((x) => [x.color_name, x.dia, x.req_kgs])]; })(),
  ["dia", [["", "74", "1150"], ["", "76", "200"]]],
);
refute("§18 …and never drops a weight", (() => { const r = replanForStage(folded, 0, nk); return reqKgsOf(r); })(), null);
check("§18 → GREIGE from Colour (one dia on the row) becomes Fabric with Σ", (() => {
  const r = replanForStage(pl({ plan_by: "colour", finish_dia: "74", rows: [{ key: "a", color_name: "WHITE", print_name: "", dia: "", req_kgs: "400" }, { key: "b", color_name: "RED", print_name: "", dia: "", req_kgs: "750" }] }), 0, nk);
  return [r.plan_by, r.color_name, r.finish_dia, r.req_kgs];
})(), ["fabric", "", "74", "1150"]);
check("§18 off a Print stage the prints go, colours stay", (() => {
  const r = replanForStage(pl({ plan_by: "colour_dia", rows: [{ key: "a", color_name: "WHITE", print_name: "AOP", dia: "74", req_kgs: "1" }] }), 1, nk);
  return r.rows.map((x) => [x.color_name, x.print_name]);
})(), [["WHITE", ""]]);

// the wiring
check("§18 the Req Wt cell is the door under a split", /reqKgsOf\(r\);[\s\S]{0,900}?openBreakup\(r,/.test(screenSrc), true);
check("§18 …and Plan by is offered by the Stage", /planByFor\(fabricStageRank\(r\.stage_id\)\)/.test(screenSrc), true);
check("§18 …and a Stage change re-plans", /replanForStage\(x, rank, newKey\)/.test(screenSrc), true);

if (failed) {
  console.error(`\n${failed} IWO Fabric BOM vector(s) failed.`);
  process.exit(1);
}
console.log("\nIWO Fabric BOM: the typed weight reaches the order engine intact.");
