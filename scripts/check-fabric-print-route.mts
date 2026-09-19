/**
 * Vectors for the three Fabric BOM ▸ Fabric Process fixes of 2026-09-19
 * (client review, recorded discussion):
 *
 *   1. A dyed roll can be BOUGHT — DYED FABRIC PURCHASE opens the Dyed stage,
 *      the route's first step decides the fabric's source (`sourceFromRoute`),
 *      and a purchase anywhere but first is refused (`clothPurchaseNotFirst`).
 *      Process sub-categories reach the Process ▾ (`processPickerItems`).
 *   2. Printing is ISOLATED — an unprinted colourway's ladder leaves the print
 *      stage out (`routeForPrint`), and the printing report groups only what
 *      prints (`printRequirement`).
 *   3. No 4-row cap, and print checkpoints A + B (`printRouteProblems`).
 *
 * Every assertion that names a rule checks WHICH rule spoke (the `rule`
 * field), not only how many problems came back — a count vector passes against
 * the wrong rule ([[raagam-diff-vectors-assert-labels]]).
 *
 * Runs under `tsx` (the `@/` alias and extensionless imports):
 *   npx --yes tsx scripts/check-fabric-print-route.mts
 */
import {
  narrowToStage,
  processLabel,
  processPickValue,
  processPickerItems,
  splitProcessPick,
  stageRouteProblems,
  type FabricProcessOption,
  type FabricProcessRow,
} from "../lib/orders/fabric-bom/processes.ts";
import { clothPurchaseNotFirst } from "../lib/orders/fabric-bom/stage-routes.ts";
import {
  comboUplift,
  comboUpliftBreakdown,
  routeForPrint,
  type RouteStage,
} from "../lib/orders/fabric-bom/yarn-process.ts";
import {
  effectiveFabricSource,
  resolveFabricSource,
  sourceFromRoute,
} from "../lib/orders/fabric-bom/fabric-source.ts";
import {
  compositionsBuyingYarn,
  yarnPurchase,
  type FabricGross,
} from "../lib/orders/fabric-bom/yarn-process.ts";
import { consolidateContributions, mergeGreigeLines } from "../lib/orders/fabric-bom/stage-ledger.ts";
import {
  printRequirement,
  printRouteProblems,
  printedGroup,
} from "../lib/orders/fabric-bom/print-route.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

// ---- fixtures: the live master after 0583 (checked 2026-09-19) -------------
const GREIGE = { id: "st-grey", code: "grey", name: "GREIGE" };
const DYED = { id: "st-dyed", code: "dyed", name: "DYED" };
const WASH = { id: "st-wash", code: "WASH", name: "WASH" };
const PRINT = { id: "st-print", code: "PRINT", name: "PRINT" };
const STAGES = [GREIGE, DYED, WASH, PRINT];

function proc(
  id: string,
  name: string,
  roles: { stage_id: string; is_base: boolean }[],
  extra: Partial<FabricProcessOption> = {},
): FabricProcessOption {
  return {
    id,
    code: null,
    name,
    inactive: false,
    for_fabric: true,
    is_print: false,
    is_dyeing: false,
    is_knitting: false,
    stage_roles: roles,
    ...extra,
  };
}
const base = (s: { id: string }) => ({ stage_id: s.id, is_base: true });
const also = (s: { id: string }) => ({ stage_id: s.id, is_base: false });

const KNITTING = proc("p-knit", "KNITTING", [base(GREIGE)], { is_knitting: true });
const FABRIC_PURCHASE = proc("p-fpur", "FABRIC PURCHASE", [base(GREIGE)], { is_cloth_purchase: true });
const DYEING = proc("p-dye", "DYEING", [base(DYED)], {
  is_dyeing: true,
  sub_categories: [{ id: "sc-bio", name: "WITH BIOWASH" }],
});
const DYED_FABRIC_PURCHASE = proc("p-dpur", "DYED FABRIC PURCHASE", [base(DYED)], { is_cloth_purchase: true });
const STENTERING = proc("p-sten", "STENTERING", [also(DYED), also(WASH)]);
const COMPACTING = proc("p-comp", "COMPACTING [OPEN WIDTH]", [also(GREIGE), also(DYED), also(WASH), also(PRINT)]);
const WASHING = proc("p-wash", "WASHING", [base(WASH)], {
  sub_categories: [
    { id: "sc-hot", name: "HOTWASH" },
    { id: "sc-old", name: "OLDWASH", hidden: true },
  ],
});
const PRINTING = proc("p-print", "PRINTING", [base(PRINT)], { is_print: true });
const DIP_WASH = proc("p-dip", "DIP-WASH", [also(PRINT)]);
const MASTER = [KNITTING, FABRIC_PURCHASE, DYEING, DYED_FABRIC_PURCHASE, STENTERING, COMPACTING, WASHING, PRINTING, DIP_WASH];

let k = 0;
function row(stage: { id: string }, p: FabricProcessOption, over: Partial<FabricProcessRow> = {}): FabricProcessRow {
  return {
    key: `r${k++}`,
    item_id: "fab-1",
    combo: null,
    component_id: null,
    stage_id: stage.id,
    process_id: p.id,
    loss_for_id: null,
    loss_pct: "",
    type_id: null,
    ...over,
  };
}

// ===========================================================================
console.log("\n--- 1a. a dyed roll can be bought ---");
// ===========================================================================
check(
  "the Dyed stage's opening step offers DYEING or DYED FABRIC PURCHASE",
  narrowToStage(MASTER, { stageId: DYED.id, isFirstOfStage: true }).map((p) => p.name).sort(),
  ["DYED FABRIC PURCHASE", "DYEING"],
);
check(
  "a route opening [DYED] DYED FABRIC PURCHASE → COMPACTING → PRINTING is fault-free",
  stageRouteProblems(
    [row(DYED, DYED_FABRIC_PURCHASE), row(DYED, COMPACTING), row(PRINT, PRINTING)],
    MASTER,
    STAGES,
  ).map((p) => p.message),
  [],
);
{
  const live = [row(GREIGE, KNITTING), row(DYED, DYEING), row(DYED, DYED_FABRIC_PURCHASE)];
  check("the live mistake — a purchase BELOW knitting and dyeing — is caught by clothPurchaseNotFirst", clothPurchaseNotFirst(live, 2, MASTER), true);
  const msgs = stageRouteProblems(live, MASTER, STAGES).map((p) => p.message);
  check("…and Save refuses it with the 'route starts' sentence", msgs.length === 1 && msgs[0].includes("is where this fabric's route starts"), true);
  check("a purchase as the FIRST step is not flagged", clothPurchaseNotFirst([row(DYED, DYED_FABRIC_PURCHASE)], 0, MASTER), false);
}

check(
  "source: [DYED] DYED FABRIC PURCHASE first → dyed_purchase",
  sourceFromRoute([row(DYED, DYED_FABRIC_PURCHASE), row(DYED, COMPACTING)], MASTER, STAGES).get("fab-1"),
  "dyed_purchase",
);
check(
  "source: [GREIGE] FABRIC PURCHASE first → greige_purchase (0564's Rule 2, finally wired)",
  sourceFromRoute([row(GREIGE, FABRIC_PURCHASE), row(DYED, DYEING)], MASTER, STAGES).get("fab-1"),
  "greige_purchase",
);
check(
  "source: KNITTING first → yarn_knit",
  sourceFromRoute([row(GREIGE, KNITTING), row(DYED, DYEING)], MASTER, STAGES).get("fab-1"),
  "yarn_knit",
);
check(
  "source: a fabric with no route is absent — the stored source stands",
  sourceFromRoute([], MASTER, STAGES).has("fab-1"),
  false,
);
check(
  "source: a purchase in an UNRANKED stage buys nothing (Rule 1 over-buys, never guesses)",
  sourceFromRoute([row({ id: "st-odd" }, DYED_FABRIC_PURCHASE)], MASTER, [...STAGES, { id: "st-odd", code: "X", name: "FINISHED" }]).get("fab-1"),
  "yarn_knit",
);
{
  const split = sourceFromRoute(
    [row(DYED, DYED_FABRIC_PURCHASE, { combo: "RED" }), row(GREIGE, KNITTING, { combo: "WHITE" })],
    MASTER,
    STAGES,
  ).get("fab-1");
  check("source: branches that disagree are REFUSED, not averaged", typeof split === "object" && split !== null && "refused" in split, true);
}
check("resolveFabricSource: one agreed answer stands", resolveFabricSource(["dyed_purchase", "dyed_purchase"]), "dyed_purchase");
check("effectiveFabricSource: the route wins over a stored value", effectiveFabricSource("yarn_knit", "dyed_purchase"), "dyed_purchase");
check("effectiveFabricSource: no route → the stored value", effectiveFabricSource("greige_purchase", undefined), "greige_purchase");
check("effectiveFabricSource: a refusal computes as Rule 1", effectiveFabricSource("dyed_purchase", { refused: "x" }), "yarn_knit");

// ===========================================================================
console.log("\n--- 1b. sub-categories reach the Process ▾ ---");
// ===========================================================================
check(
  "each process, then PROCESS [SUB]; a hidden sub-category is not offered",
  processPickerItems([DYEING, WASHING]).map((i) => i.name),
  ["DYEING", "DYEING [WITH BIOWASH]", "WASHING", "WASHING [HOTWASH]"],
);
check(
  "…but a HELD hidden sub-category survives, greyed, under its real name",
  processPickerItems([WASHING], { process_id: "p-wash", sub_category_id: "sc-old" })
    .filter((i) => i.id === "p-wash|sc-old")
    .map((i) => [i.name, i.inactive]),
  [["WASHING [OLDWASH]", true]],
);
check("pick value round-trips", splitProcessPick(processPickValue({ process_id: "p-dye", sub_category_id: "sc-bio" })), {
  process_id: "p-dye",
  sub_category_id: "sc-bio",
});
check("a plain process picks with no sub-category", splitProcessPick("p-dye"), { process_id: "p-dye", sub_category_id: null });
check("processLabel reads the legacy way", processLabel(DYEING, "sc-bio"), "DYEING [WITH BIOWASH]");
check("processLabel of an unknown sub falls back to the process", processLabel(DYEING, "sc-gone"), "DYEING");

// ===========================================================================
console.log("\n--- 3. no 4-row cap ---");
// ===========================================================================
check(
  "an 8-step chain (knit → dye → stenter → compact → print → dip-wash → compact) has no fault",
  stageRouteProblems(
    [
      row(GREIGE, KNITTING),
      row(DYED, DYEING),
      row(DYED, STENTERING),
      row(DYED, COMPACTING),
      row(PRINT, PRINTING),
      row(PRINT, DIP_WASH),
      row(PRINT, COMPACTING),
    ],
    MASTER,
    STAGES,
  ).map((p) => p.message),
  [],
);

// ===========================================================================
console.log("\n--- 2. print isolation in the ladder ---");
// ===========================================================================
const step = (stage: { id: string }, p: FabricProcessOption, loss: number, combo: string | null = null): RouteStage => ({
  combo,
  loss_pct: loss,
  stage_id: stage.id,
  process_id: p.id,
  is_print: p.is_print,
});
const ROUTE: RouteStage[] = [
  step(GREIGE, KNITTING, 2),
  step(DYED, DYEING, 5),
  step(PRINT, PRINTING, 4),
  step(PRINT, DIP_WASH, 3),
  step(PRINT, COMPACTING, 1),
];
check(
  "unprinted: the WHOLE print stage leaves — PRINTING, DIP-WASH and the post-print COMPACTING",
  routeForPrint(ROUTE, false).map((s) => s.process_id),
  ["p-knit", "p-dye"],
);
check("printed: nothing leaves", routeForPrint(ROUTE, true).length, 5);
check("undefined (every pre-existing caller): nothing leaves", routeForPrint(ROUTE, undefined).length, 5);
check(
  "a COMPACTING before printing (Dyed stage) is NOT dropped for an unprinted colour",
  routeForPrint([step(DYED, COMPACTING, 1), ...ROUTE], false).map((s) => s.process_id),
  ["p-comp", "p-knit", "p-dye"],
);
const f = (x: number | { refused: string }) => (typeof x === "number" ? Number(x.toFixed(6)) : x);
check(
  "factor, unprinted = knit + dye only: 1/(0.98·0.95)",
  f(comboUplift(ROUTE, "", [], "yarn_knit", false)),
  Number((1 / (0.98 * 0.95)).toFixed(6)),
);
check(
  "factor, printed = today's whole-route factor exactly",
  f(comboUplift(ROUTE, "", [], "yarn_knit", true)),
  f(comboUplift(ROUTE, "")),
);
{
  const b = comboUpliftBreakdown([...ROUTE].reverse(), "", [], "yarn_knit", false);
  check(
    "the breakdown agrees with the factor, and prints no PRINTING row for an unprinted group",
    typeof b === "object" && "steps" in b ? b.steps.map((s) => s.process_id) : b,
    ["p-dye", "p-knit"],
  );
}

// ---- printedGroup ----------------------------------------------------------
const LINES = [
  { item_id: "fab-1", combo: "NAVY", component_id: "c-body", required_print: "AOP" },
  { item_id: "fab-1", combo: "NAVY", component_id: "c-sleeve", required_print: "" },
  { item_id: "fab-1", combo: "WHITE", component_id: "c-body", required_print: null },
];
check("NAVY body prints", printedGroup(LINES, "fab-1", "NAVY", ["c-body"]), true);
check("NAVY sleeve does not", printedGroup(LINES, "fab-1", "NAVY", ["c-sleeve"]), false);
check("WHITE does not", printedGroup(LINES, "fab-1", "WHITE", []), false);
check("colourway matched case-blind (comboKey)", printedGroup(LINES, "fab-1", " navy ", []), true);
check("blank colourway = any: the fabric prints somewhere", printedGroup(LINES, "fab-1", "", []), true);
check("another fabric does not", printedGroup(LINES, "fab-2", "NAVY", []), false);

// ===========================================================================
console.log("\n--- 3. checkpoints A and B ---");
// ===========================================================================
const isPrint = (id: string) => MASTER.find((p) => p.id === id)?.is_print ?? false;
const rulesOf = (xs: { rule: string }[]) => xs.map((x) => x.rule);
check(
  "A: NAVY body prints but the route has no Printing step",
  rulesOf(printRouteProblems([row(GREIGE, KNITTING), row(DYED, DYEING)], LINES, isPrint)),
  ["print-missing"],
);
check(
  "A: …also when the fabric has no route at all",
  rulesOf(printRouteProblems([], LINES, isPrint)),
  ["print-missing"],
);
check(
  "A + B satisfied: an unsplit route with Printing serves the printed NAVY body",
  rulesOf(printRouteProblems([row(GREIGE, KNITTING), row(PRINT, PRINTING)], LINES, isPrint)),
  [],
);
check(
  "A: a Printing step scoped to WHITE does not cover NAVY",
  rulesOf(printRouteProblems([row(PRINT, PRINTING, { combo: "WHITE" })], LINES, isPrint)).sort(),
  ["print-missing", "print-unused"],
);
check(
  "B: Printing on a fabric nothing prints",
  rulesOf(printRouteProblems([row(PRINT, PRINTING, { item_id: "fab-2" })], LINES, isPrint)).includes("print-unused"),
  true,
);
check(
  "B's per-branch gate: stageRouteProblems withholds Printing from WHITE's branch (no pair fault, no base fault for a gated stage)",
  stageRouteProblems([row(PRINT, PRINTING, { combo: "WHITE" })], MASTER, STAGES, {
    gatesFor: (itemId, combo) => ({ printDeclared: printedGroup(LINES, itemId, combo, []) }),
  }).length,
  0,
);

// ===========================================================================
console.log("\n--- 2. the printing requirement groups per colourway ---");
// ===========================================================================
{
  const r = printRequirement([
    { processName: "PRINTING", fabricName: "SJ", combo: "NAVY", component: "BODY", print: "AOP", dia: "", lossPct: 4, sentWt: 104.2, receivedWt: 100 },
    { processName: "PRINTING", fabricName: "SJ", combo: "NAVY", component: "SLEEVE", print: "AOP", dia: "", lossPct: 4, sentWt: 52.1, receivedWt: 50 },
    { processName: "PRINTING", fabricName: "RIB", combo: "RED", component: "", print: "ROTARY", dia: "", lossPct: 4, sentWt: 10.42, receivedWt: 10 },
  ]);
  check("two colourway groups, in arrival order", r.groups.map((g) => g.combo), ["NAVY", "RED"]);
  check("NAVY's sent total", Number(r.groups[0].sentWt.toFixed(3)), 156.3);
  check("grand total sent", Number(r.sentWt.toFixed(3)), 166.72);
  check("grand total received", r.receivedWt, 160);
}

// ===========================================================================
console.log("\n--- 4. yarn rules (client 2026-09-19) ---");
// ===========================================================================
{
  const COMP = new Map([["fab-1", { fabric_id: "fab-1", fabric_name: "SJ", components: [{ yarn_id: "y-1", blend_pct: 100 }] }]]);
  /* Three colourways of 10.001 kg each at 2 dp: rounded per colourway that is
     3 × 10.01 = 30.03; rounded once it is ceil(30.003) = 30.01. */
  const gross = (combo: string): FabricGross => ({ fabric_id: "fab-1", combo, gross: 10.001, uom_id: "kg" });
  const three = [gross("NAVY"), gross("RED"), gross("WHITE")];
  const r = yarnPurchase("y-1", three, COMP, new Map(), [], 2);
  check("Rule 1: grey yarn is ONE lot, rounded once — 30.01, not 30.03", typeof r === "object" && "qty" in r ? r.qty : r, 30.01);
  check(
    "…while each colourway keeps its own rounded share (colour-scoped steps are charged on those)",
    typeof r === "object" && "byCombo" in r ? r.byCombo.map((c) => c.gross) : r,
    [10.01, 10.01, 10.01],
  );

  /* ONE DYEING LOSS: a shade with a 5% dye loss AND a typed dyeing step at 5%. */
  const one = [{ fabric_id: "fab-1", combo: "NAVY", gross: 100, uom_id: "kg" }] as FabricGross[];
  const shades = [{ fabric_id: "fab-1", yarn_id: "y-1", combo: "NAVY", share: 1, loss_pct: 5 }];
  const typedDye = [{ combo: null, loss_pct: 5, dyed: true }];
  const withShade = yarnPurchase("y-1", one, COMP, new Map(), typedDye, 2, new Map(), shades);
  check(
    "Rule 3 decision: shade loss present → the typed DYED step adds NO purchase weight (100/0.95 = 105.27, not 110.81)",
    typeof withShade === "object" && "qty" in withShade ? withShade.qty : withShade,
    105.27,
  );
  const noShade = yarnPurchase("y-1", one, COMP, new Map(), typedDye, 2);
  check(
    "…with no shade loss the typed step still counts, exactly as before",
    typeof noShade === "object" && "qty" in noShade ? noShade.qty : noShade,
    105.27,
  );
  const greyStep = yarnPurchase("y-1", one, COMP, new Map(), [{ combo: null, loss_pct: 2, dyed: false }], 2, new Map(), shades);
  check(
    "…and a GREY-stage yarn step is untouched by the rule (100/0.98/0.95 = 107.42)",
    typeof greyStep === "object" && "qty" in greyStep ? greyStep.qty : greyStep,
    107.42,
  );

  const src = (id: string) => (id === "fab-bought" ? ("dyed_purchase" as const) : ("yarn_knit" as const));
  check(
    "Rule 2: a bought cloth's composition buys no yarn",
    compositionsBuyingYarn([{ fabric_id: "fab-1" }, { fabric_id: "fab-bought" }], src).map((c) => c.fabric_id),
    ["fab-1"],
  );
}

// ===========================================================================
console.log("\n--- 5. greige sections are one line per fabric ---");
// ===========================================================================
{
  const line = (combo: string, wt: number, extra: Record<string, unknown> = {}) => ({
    itemId: "fab-1", fabricName: "SJ", combo, component: null, lossPct: 2,
    plannedWt: wt, toOrderedWt: wt * 1.02, dia: "30", fabricColour: combo, ydComboName: null,
    mixingText: null, formLabel: null, gsm: null, plannedNos: null, toOrderedNos: null, nosUomCode: null,
    ...extra,
  });
  const m = mergeGreigeLines([line("NAVY", 500), line("RED", 300), line("WHITE", 270)] as never);
  check("KNITTING across three colourways → ONE line of 1070", m.map((l) => [l.combo, l.plannedWt]), [[null, 1070]]);
  check("…with no colour claimed for grey cloth", m[0].fabricColour, null);
  const yd = mergeGreigeLines([line("NAVY", 500, { ydComboName: "YD-1" }), line("RED", 300, { ydComboName: "YD-2" })] as never);
  check("a YARN-DYED cloth keeps its lots apart (its colour exists before knitting)", yd.length, 2);
  const dias = mergeGreigeLines([line("NAVY", 1, { dia: "30" }), line("RED", 1, { dia: "32" })] as never);
  check("two different dias print none rather than one", dias[0].dia, null);
  check(
    "yarn drill-down: one contribution per fabric, colourways summed",
    consolidateContributions([
      { fabricName: "SJ", combo: "NAVY", component: null, wt: 10 },
      { fabricName: "SJ", combo: "RED", component: null, wt: 5 },
    ]),
    [{ fabricName: "SJ", combo: null, component: null, wt: 15 }],
  );
}

if (failed) {
  console.error(`\n${failed} fabric print-route vector(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll fabric print-route vectors passed.");
