/**
 * Vectors for the YARN side of "the Stage decides the Process"
 * (`lib/orders/fabric-bom/yarn-stage-routes.ts`; client spec 2026-09-21,
 * plan `doc/order/yarn-stage-logic-plan.md`).
 *
 * Run: npx tsx scripts/check-yarn-stage-routes.mts
 */
import {
  narrowYarnToStage,
  opensYarnStage,
  yarnBaseMissing,
  yarnBasesForStage,
  yarnStageMismatch,
  yarnStageProblems,
  yarnStageTwins,
} from "../lib/orders/fabric-bom/yarn-stage-routes";
import { processesForYarn } from "../lib/orders/fabric-bom/yarn-process";
import { baseStageProblem } from "../lib/masters/process-types";

let failed = 0;
let passed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Fabric stage → yarn stage, BY CODE (then name). WASH/PRINT have no twin.
// ---------------------------------------------------------------------------
const FAB = [
  { id: "f-grey", code: "grey", name: "GREIGE" },
  { id: "f-dyed", code: "dyed", name: "DYED" },
  { id: "f-wash", code: "WASH", name: "WASH" },
  { id: "f-print", code: "PRINT", name: "PRINT" },
];
const YARN = [
  { id: "y-grey", code: "grey", name: "GREIGE" },
  { id: "y-dyed", code: "dyed", name: "DYED" },
];
const twins = yarnStageTwins(FAB, YARN);
check("grey ↔ grey, dyed ↔ dyed", [twins.get("f-grey"), twins.get("f-dyed")], ["y-grey", "y-dyed"]);
check("WASH and PRINT have no yarn twin", [twins.has("f-wash"), twins.has("f-print")], [false, false]);
check("a renamed, code-less GREIGE still matches by name", yarnStageTwins([{ id: "f", code: null, name: "Greige" }], YARN).get("f"), "y-grey");
check("GREY and GREIGE are one stage", yarnStageTwins([{ id: "f", code: "greige", name: "X" }], [{ id: "y", code: "grey", name: "GREY" }]).get("f"), "y");

// ---------------------------------------------------------------------------
// 2. The narrowing: allowed, then base first, unmapped = universal, empty = open.
// ---------------------------------------------------------------------------
const P = {
  purchase: { id: "yp", name: "YARN PURCHASE", code: null, inactive: false, for_yarn: true, stage_roles: [{ stage_id: "y-grey", is_base: true }] },
  dyeing: { id: "yd", name: "YARN DYEING", code: null, inactive: false, for_yarn: true, stage_roles: [{ stage_id: "y-dyed", is_base: true }] },
  winding: { id: "sw", name: "SOFT WINDING", code: null, inactive: false, for_yarn: true, stage_roles: [{ stage_id: "y-dyed", is_base: false }] },
  merc: { id: "mc", name: "MERCERISING", code: null, inactive: false, for_yarn: true, stage_roles: [] },
  knitting: { id: "kn", name: "KNITTING", code: null, inactive: false, for_yarn: false, stage_roles: [{ stage_id: "y-grey", is_base: true }] },
};
const ALL = Object.values(P);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

check("no stage → every yarn process (KNITTING is not for_yarn)", ids(processesForYarn(ALL)), ["yp", "yd", "sw", "mc"]);
check("DYED → its processes + the unclassified one", ids(processesForYarn(ALL, { stageId: "y-dyed" })), ["yd", "sw", "mc"]);
check("first step under DYED → YARN DYEING only", ids(processesForYarn(ALL, { stageId: "y-dyed", isFirstOfStage: true })), ["yd"]);
check("first step under GREIGE → YARN PURCHASE, never the fabric KNITTING", ids(processesForYarn(ALL, { stageId: "y-grey", isFirstOfStage: true })), ["yp"]);
check("a stage nothing yarn-side is classified for falls open", ids(narrowYarnToStage([P.merc], { stageId: "y-grey", isFirstOfStage: true })), ["mc"]);
check("the held value survives a stage that would not offer it", ids(processesForYarn(ALL, { stageId: "y-dyed", isFirstOfStage: true, currentValue: "sw" })), ["yd", "sw"]);
check("an inactive-free list still drops nothing by mistake", processesForYarn(ALL, { stageId: "y-grey" }).length, 2);

// ---------------------------------------------------------------------------
// 3. The twins and the Save rule.
// ---------------------------------------------------------------------------
const YARN_OPTS = ALL.filter((p) => p.for_yarn);
check("GREIGE + YARN DYEING is a mismatch", yarnStageMismatch({ stage_id: "y-grey", process_id: "yd" }, YARN_OPTS), true);
check("DYED + YARN DYEING is fine", yarnStageMismatch({ stage_id: "y-dyed", process_id: "yd" }, YARN_OPTS), false);
check("an unclassified process mismatches nothing", yarnStageMismatch({ stage_id: "y-grey", process_id: "mc" }, YARN_OPTS), false);
const rows = [
  { stage_id: "y-dyed", process_id: "sw" },
  { stage_id: "y-dyed", process_id: "yd" },
];
check("row 0 opens DYED, row 1 does not", [opensYarnStage(rows, 0), opensYarnStage(rows, 1)], [true, false]);
check("DYED opened by SOFT WINDING → base missing", yarnBaseMissing(rows, 0, YARN_OPTS), true);
check("...the second row is not asked for a base", yarnBaseMissing(rows, 1, YARN_OPTS), false);
check("GREIGE's yarn base is YARN PURCHASE alone", ids(yarnBasesForStage(YARN_OPTS, "y-grey")), ["yp"]);
const problems = yarnStageProblems(
  [
    { name: "34'S BCI COTTON", stages: [{ stage_id: "y-grey", process_id: "yd" }] },
    { name: "20 DINER", stages: rows },
  ],
  YARN_OPTS,
  YARN,
);
check("the Save rule names the yarn, the stage and the fix", problems, [
  "34'S BCI COTTON: GREIGE does not run YARN DYEING — change the Stage or pick another process.",
  "20 DINER: the first step under DYED must be YARN DYEING, not SOFT WINDING.",
]);
check("a clean document has no problems", yarnStageProblems([{ name: "Y", stages: [{ stage_id: "y-dyed", process_id: "yd" }, { stage_id: "y-dyed", process_id: "sw" }] }], YARN_OPTS, YARN), []);

// ---------------------------------------------------------------------------
// 4. The master: a yarn process is checked for one base too.
// ---------------------------------------------------------------------------
check(
  "a for_yarn process Base on two stages is refused at the master",
  baseStageProblem({ for_fabric: false, for_yarn: true, fabric_stages: [{ stage_id: "a", is_base: true }, { stage_id: "b", is_base: true }] }) !== null,
  true,
);
check("a process for neither is not checked", baseStageProblem({ for_fabric: false, for_yarn: false, fabric_stages: [{ stage_id: "a", is_base: true }, { stage_id: "b", is_base: true }] }), null);

/*
 * MADE TO FAIL FIRST (2026-09-21):
 *   yarnStageTwins matching by id instead of code ......... 3
 *   narrowYarnToStage skipping the base-first step ......... 3
 *   yarnBaseMissing not standing down past the first row .. 1
 *   baseStageProblem ignoring for_yarn ..................... 1
 */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
