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
// Dyeing (the grey total bought once, a dyeing step per shade).
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
  "§12 Yarn Dyeing: every shade needs its own dyeing step",
  msgs({ item_id: COTTON, buy_stage_id: "dyed", planned_kgs: null, colour_by: "yarn_dyeing", shades: [navy, black], steps: [dye("NAVY")] }),
  ["Yarn line 1: add a Yarn Dyeing step For BLACK on Yarn Process."],
);
check(
  "§12 Yarn Dyeing: a dyeing step For every colour is refused — one per shade",
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
// §15 THE REFUSAL MUST BE SATISFIABLE (client 2026-09-20)
//
// §12's "choose which shade each dyeing step is For" was refused while the
// cell that names the shade was NOT ON SCREEN: `YarnProcessGrid`'s Colour cell
// is revealed by the `For` label saying COLOR WISE, and a dyeing step whose
// `For` was blank showed a dash instead. The planner could not fill it, could
// not save, and had no control to press — AGENTS.md's "A HOLD REFUSES MOVEMENT
// AND NEVER REFUSES CHOOSING", one screen along.
//
// The arithmetic vectors above cannot see that, so these read the source: the
// grid must reveal the cell for a row that owes a shade, and the SCREEN must be
// what says which rows do (only it knows the process master's `is_dyeing`).
// Both were made to FAIL against the code as it stood before the fix.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const gridSrc = read("../components/orders/yarn-process-grid.tsx");
const colourCell = gridSrc.slice(gridSrc.indexOf('header: "Colour"'));
const screenSrc = read("../app/(app)/orders/iwo-fabric-bom/iwo-fabric-bom-screen.tsx");

check(
  // The GUARD, not merely a mention of `owesCombo` anywhere in the cell: the
  // bug was exactly that the dash won whenever `For` was not COLOR WISE.
  "§15 the Colour cell's dash is guarded by `owesCombo` as well as the For label",
  /if \(!owes && !isColorWise\(/.test(colourCell),
  true,
);
check("§15 …and is `required` there, so the star and the hold come off one prop", /required=\{owes\}/.test(colourCell), true);
check(
  "§15 the IWO screen tells the grid which of its steps owe a shade",
  /<YarnProcessGrid[\s\S]{0,800}?owesCombo=\{/.test(screenSrc),
  true,
);
check(
  "§15 …and offers the line's own shades, which are known before the weight is",
  /const combos = line[\s\S]{0,200}?keptIwoYarnShades/.test(screenSrc),
  true,
);

if (failed) {
  console.error(`\n${failed} IWO Fabric BOM vector(s) failed.`);
  process.exit(1);
}
console.log("\nIWO Fabric BOM: the typed weight reaches the order engine intact.");
