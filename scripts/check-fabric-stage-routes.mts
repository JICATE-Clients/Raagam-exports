/**
 * Vectors for `lib/orders/fabric-bom/stage-routes.ts` — the Fabric Process
 * ROUTE RULE (0563, doc/order/fabriprocess.md §1 and §3).
 *
 * ## 1. THE FAILURE THIS GUARDS IS A STOCK LEDGER, NOT A DROPDOWN
 *
 * Fabric inventory is four physically distinct ledgers — Greige, Dyed, Washed,
 * Printed — and the STAGE on a route row decides which of them a step's weight
 * is logged against. `Stage = Dyed, Process = Knitting` files greige cloth as
 * dyed, and from there warehouse stock, material availability and valuation are
 * all wrong with nothing on screen saying so. Section 3 is that vector by name.
 *
 * ## 2. THE HARD HALF IS REFUSING WITHOUT STRANDING
 *
 * A narrowing that empties the ▾ is not stricter, it is unsatisfiable — the
 * operator can neither pick a value nor work around it, because there is
 * nothing in the list to click. AGENTS.md records the same lesson under
 * "Mandatory fields", where the first cut of the cursor hold refused the Enter
 * that PICKED a value and caged the operator on a field they were getting
 * right.
 *
 * That is not hypothetical here. It is the live database's day-one state,
 * twice: the master holds no WASHING and no `for_fabric` PRINTING, so the
 * Washed and Printed stages are seeded with secondary steps and NO BASE
 * (section 5); and DYEING, the only base of the Dyed stage, carries 0557's
 * `is_dyeing` and is already withheld on a Yarn-Dyed fabric — which still
 * belongs in the Dyed ledger (section 6). Both are covered, and both REFUTE
 * the empty list explicitly, so a "tightening" that removes the stand-down
 * fails here rather than in production.
 *
 * ## 3. AN UNCLASSIFIED PROCESS IS OFFERED EVERYWHERE, AND THAT IS ASSERTED
 *
 * Section 7. The alternative reading ("allowed nowhere") is refuted by name,
 * because it is the reading that makes most of the Process master unpickable
 * the moment 0563 applies. The rule tightens by CLASSIFYING, not by
 * withholding by default.
 *
 * ## 4. THE TWINS ARE CROSS-CHECKED AGAINST THE NARROWING, NOT SPOT-CHECKED
 *
 * `baseProcessMissing` mirrors `processesForFabric`'s flag test rather than
 * importing it (a shared predicate would be a runtime import cycle — see
 * `stage-routes.ts`'s header). Section 8 is what holds the mirror in place: it
 * walks EVERY (stage x printDeclared x fabricIsYarnDyed x isFirstOfStage x
 * offered process) combination and asserts neither twin ever contradicts the
 * list the narrowing just produced. Drift fails the check instead of shipping.
 *
 * ## 5. FIXTURES ARE THE LIVE DATA'S OWN SHAPE
 *
 * `LIVE` is the Process master as it actually stands (checked 2026-09-16: 17
 * rows, 7 `for_fabric`) under 0563's seed as simulated against it — 11
 * pairings, GREIGE and DYED with a base, WASH and PRINT without. `FULL` adds
 * the three names 0294's legacy import carries and this database does not
 * (WASHING, PRINTING, BIO WASH), so the "base forced on all four stages" half
 * of §3 can be asserted at all. Both are exercised; a vector that passes here
 * describes a master that exists or one this master can become.
 *
 * Runs under `tsx` for `check-fabric-plan.mts`'s reason: the module imports
 * `@/lib/...` aliases at runtime and Node's ESM resolver reads neither the
 * alias nor the missing extension.
 */
import {
  processesForFabric,
  processPickerItems,
  type FabricProcessOption,
  type FabricProcessRow,
} from "../lib/orders/fabric-bom/processes.ts";
import {
  baseProcessMissing,
  baseProcessesForStage,
  baseProcessRepeated,
  routeStartAllowedAt,
  routeStartNotFirst,
  isRouteStart,
  yarnDyedStageBlocked,
  stagesForRow,
  clothPurchaseNotFirst,
  dyeingBlocked,
  narrowToStage,
  processesUsedInStage,
  processRepeatedInStage,
  stageRouteProblems,
  stageAllowsProcess,
  stageMismatchBlocked,
} from "../lib/orders/fabric-bom/stage-routes.ts";

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

// ---------------------------------------------------------------------------
// Fixtures — the live data's own shapes (checked against the database
// 2026-09-16), so a vector that passes here describes a master that exists.
// ---------------------------------------------------------------------------

/* The four `config_lookups` fabric_stage rows AS THEY STAND, names included:
   an operator renamed 0492's `grey` row to GREIGE and added WASH and PRINT
   under their own codes. The ids are what everything here keys on — the codes
   are recorded only so the next reader knows the spellings are not the
   brief's. */
const GREIGE = "stage-grey-0000-0000-0000-000000000001"; // code 'grey',  name GREIGE
const DYED = "stage-dyed-0000-0000-0000-000000000002"; //   code 'dyed',  name DYED
const WASHED = "stage-wash-0000-0000-0000-000000000003"; // code 'WASH',  name WASH
const PRINTED = "stage-prnt-0000-0000-0000-000000000004"; // code 'PRINT', name PRINT

const STAGES = [GREIGE, DYED, WASHED, PRINTED];

/* A STAGE NO PROCESS IS CLASSIFIED AGAINST. Not invented for the test: the
   Stage cell is a `LookupDialogPicker` with inline create, which is how WASH
   and PRINT reached this database in the first place. Section 12. */
const FINISHED = "stage-finl-0000-0000-0000-000000000005";

function proc(
  id: string,
  name: string,
  roles: { stage_id: string; is_base: boolean }[],
  extra: Partial<
    Pick<
      FabricProcessOption,
      "for_fabric" | "is_print" | "is_dyeing" | "is_knitting" | "inactive" | "is_cloth_purchase" | "sub_categories"
    >
  > = {},
): FabricProcessOption {
  return {
    id,
    code: null,
    name,
    inactive: extra.inactive ?? false,
    for_fabric: extra.for_fabric ?? true,
    is_print: extra.is_print ?? false,
    is_dyeing: extra.is_dyeing ?? false,
    is_knitting: extra.is_knitting ?? false,
    is_cloth_purchase: extra.is_cloth_purchase ?? false,
    sub_categories: extra.sub_categories ?? [],
    stage_roles: roles,
  };
}
const base = (s: string) => ({ stage_id: s, is_base: true });
const also = (s: string) => ({ stage_id: s, is_base: false });

/* ---- the 7 `for_fabric` rows the live master holds, with 0563's own seed ---- */
/* `is_knitting` since 2026-09-20 — the live master flags it (0564), and the
   route-start rule reads the flag. */
const KNITTING = proc("p-knitting", "KNITTING", [base(GREIGE)], { is_knitting: true });
const HEAT_SETTING = proc("p-heatset", "HEAT SETTING", [also(GREIGE)]);
/* DYEING carries 0557's is_dyeing — it is the live master's only such row, and
   it is also the Dyed stage's only base. Section 6 is the consequence. */
const DYEING = proc("p-dyeing", "DYEING", [base(DYED)], { is_dyeing: true });
const STENTERING = proc("p-stenter", "STENTERING", [also(DYED), also(WASHED)]);
const COMPACTING_OW = proc("p-comp-ow", "COMPACTING [OPEN WIDTH]", [
  also(DYED),
  also(WASHED),
  also(PRINTED),
]);
const COMPACTING_TUB = proc("p-comp-tub", "COMPACTING [TUBULAR]", [
  also(DYED),
  also(WASHED),
  also(PRINTED),
]);
/* UNCLASSIFIED ON PURPOSE. It is §2's procurement route, not a step in §3's
   table, so 0563 leaves it with no pairing at all — the live master's one
   unclassified fabric process. Section 7. */
const FABRIC_PURCHASE = proc("p-fabpur", "FABRIC PURCHASE", []);

/** Never `for_fabric` — a garment-stage process. Must not appear anywhere,
 *  with or without a stage, which is 0227's rule and predates all of this. */
const GARMENT_DYEING = proc("p-gmtdye", "GARMENT DYEING", [], { for_fabric: false });

/** The Process master AS IT STANDS, under 0563's seed simulated against it. */
const LIVE = [
  KNITTING,
  HEAT_SETTING,
  DYEING,
  STENTERING,
  COMPACTING_OW,
  COMPACTING_TUB,
  FABRIC_PURCHASE,
  GARMENT_DYEING,
];

/* ---- the three names 0294's import carries and this database does not ---- */
const WASHING = proc("p-washing", "WASHING", [base(WASHED)]);
/* PRINTING carries 0528's is_print, seeded from the name — so the Printed
   stage's base is withheld until the order declares an AOP / Roll form print.
   Section 6's second half. */
const PRINTING = proc("p-printing", "PRINTING", [base(PRINTED)], { is_print: true });
const BIO_WASH = proc("p-biowash", "BIO WASH AFTER COMPACTING", [also(WASHED)]);
const DIP_WASHING = proc("p-dipwash", "DIP WASHING", [also(PRINTED)]);

/** A master where all four stages have a base — what §3's table describes. */
const FULL = [...LIVE, WASHING, PRINTING, BIO_WASH, DIP_WASHING];

/* THE LIVE MASTER TWO ORDINARY OPERATOR ACTIONS LATER. `FABRIC PURCHASE` has
   been classified to Greige — correct, it is §2's greige entry — so NOTHING
   `for_fabric` is unclassified any more, and nothing silently lands in every
   stage. GARMENT DYEING stays unclassified on purpose: it is not `for_fabric`,
   so it must not be what keeps a stage's list non-empty. Section 12. */
const FABRIC_PURCHASE_CLASSIFIED = proc("p-fabpur", "FABRIC PURCHASE", [also(GREIGE)]);
const CLASSIFIED = LIVE.map((p) =>
  p.id === FABRIC_PURCHASE.id ? FABRIC_PURCHASE_CLASSIFIED : p,
);

/* THE MASTER AFTER 0570 + 0583 (checked live 2026-09-19): both purchases
   flagged `is_cloth_purchase` and each the BASE of the stage its roll
   arrives in, and DYEING carrying its one sub-category. Sections 10 and 13. */
const FABRIC_PURCHASE_0583 = proc("p-fabpur", "FABRIC PURCHASE", [base(GREIGE)], { is_cloth_purchase: true });
const DYED_FABRIC_PURCHASE = proc("p-dyedpur", "DYED FABRIC PURCHASE", [base(DYED)], { is_cloth_purchase: true });
const DYEING_0583 = proc("p-dyeing", "DYEING", [base(DYED)], {
  is_dyeing: true,
  sub_categories: [{ id: "sc-biowash", name: "WITH BIOWASH" }],
});
const M583 = [
  ...FULL.filter((p) => p.id !== FABRIC_PURCHASE.id && p.id !== DYEING.id),
  FABRIC_PURCHASE_0583,
  DYED_FABRIC_PURCHASE,
  DYEING_0583,
];

const names = (list: readonly FabricProcessOption[]) => list.map((p) => p.name).sort();
function offered(
  master: readonly FabricProcessOption[],
  opts: Parameters<typeof processesForFabric>[1],
) {
  return names(processesForFabric(master, opts));
}
function row(stage: string | null, process: string | null): FabricProcessRow {
  return {
    key: `k-${stage}-${process}`,
    item_id: "fabric-1",
    combo: null,
    component_id: null,
    stage_id: stage,
    process_id: process,
    loss_for_id: null,
    loss_pct: "",
    type_id: null,
  };
}

// ===========================================================================
console.log("\n--- 1. every existing call site keeps its exact behaviour ---");
// ===========================================================================
/* THE WHOLE POINT OF BOTH OPTS DEFAULTING OFF. `processesForFabric` has ~19
   call sites that name no stage, and 0563 must be invisible to every one of
   them — the same promise `printDeclared` and `fabricIsYarnDyed` each made. */
check(
  "no stageId: the unfiltered for_fabric list, exactly as before 0563",
  offered(LIVE, {}),
  names(LIVE.filter((p) => p.for_fabric)),
);
check("no stageId: GARMENT DYEING is still absent (for_fabric, 0227)", offered(LIVE, {}).includes("GARMENT DYEING"), false);
check(
  "stageId explicitly null narrows nothing either",
  offered(LIVE, { stageId: null, isFirstOfStage: true }),
  names(LIVE.filter((p) => p.for_fabric)),
);

// ===========================================================================
console.log("\n--- 2. §1's headline: the stage refuses the wrong process ---");
// ===========================================================================
check(
  "DYEING is REFUSED under Greige — the weight would land in the Dyed ledger",
  offered(LIVE, { stageId: GREIGE }).includes("DYEING"),
  false,
);
check(
  "KNITTING is REFUSED under Dyed — greige cloth filed as dyed stock (§1)",
  offered(LIVE, { stageId: DYED }).includes("KNITTING"),
  false,
);
check(
  "KNITTING is REFUSED under Washed and Printed too, not only under Dyed",
  [WASHED, PRINTED].map((s) => offered(LIVE, { stageId: s }).includes("KNITTING")),
  [false, false],
);
check(
  "Greige offers exactly its own two steps, plus the unclassified one",
  offered(LIVE, { stageId: GREIGE }),
  ["FABRIC PURCHASE", "HEAT SETTING", "KNITTING"],
);
check(
  "HEAT SETTING is a GREIGE step and is refused in the other three stages",
  [DYED, WASHED, PRINTED].map((s) => offered(LIVE, { stageId: s }).includes("HEAT SETTING")),
  [false, false, false],
);

// ===========================================================================
console.log("\n--- 3. one process, several stages — why this is a TABLE ---");
// ===========================================================================
/* The reason a `processes.fabric_stage_id` column cannot express the rule: a
   single answer per process would have to refuse two of these three. */
check(
  "COMPACTING [OPEN WIDTH] is offered in Dyed, Washed AND Printed",
  [DYED, WASHED, PRINTED].map((s) => offered(LIVE, { stageId: s }).includes("COMPACTING [OPEN WIDTH]")),
  [true, true, true],
);
check(
  "…and is still refused in Greige — three stages is not four",
  offered(LIVE, { stageId: GREIGE }).includes("COMPACTING [OPEN WIDTH]"),
  false,
);
check(
  "STENTERING is offered in Dyed and Washed, refused in Greige and Printed",
  [GREIGE, DYED, WASHED, PRINTED].map((s) => offered(LIVE, { stageId: s }).includes("STENTERING")),
  [false, true, true, false],
);

// ===========================================================================
console.log("\n--- 4. the base process is forced as the FIRST step of a stage ---");
// ===========================================================================
check(
  "Greige opens on KNITTING and nothing else",
  offered(FULL, { stageId: GREIGE, isFirstOfStage: true }),
  ["KNITTING"],
);
check(
  "Dyed opens on DYEING and nothing else",
  offered(FULL, { stageId: DYED, isFirstOfStage: true }),
  ["DYEING"],
);
check(
  "Washed opens on WASHING and nothing else",
  offered(FULL, { stageId: WASHED, isFirstOfStage: true }),
  ["WASHING"],
);
check(
  "Printed opens on PRINTING and nothing else",
  offered(FULL, { stageId: PRINTED, isFirstOfStage: true }),
  ["PRINTING"],
);
refute(
  "the FIRST step of Greige is not simply the whole stage list",
  offered(FULL, { stageId: GREIGE, isFirstOfStage: true }),
  offered(FULL, { stageId: GREIGE }),
);
check(
  "an UNCLASSIFIED process is not a base — FABRIC PURCHASE cannot open Greige",
  offered(FULL, { stageId: GREIGE, isFirstOfStage: true }).includes("FABRIC PURCHASE"),
  false,
);

console.log("\n     …and a secondary process is offered only AFTER the base:");
check(
  "HEAT SETTING is refused as Greige's first step",
  offered(FULL, { stageId: GREIGE, isFirstOfStage: true }).includes("HEAT SETTING"),
  false,
);
check(
  "…and offered as a later step of the same stage",
  offered(FULL, { stageId: GREIGE, isFirstOfStage: false }).includes("HEAT SETTING"),
  true,
);
check(
  "STENTERING / COMPACTING are refused as Dyed's first step, offered after it",
  [
    offered(FULL, { stageId: DYED, isFirstOfStage: true }).includes("STENTERING"),
    offered(FULL, { stageId: DYED, isFirstOfStage: false }).includes("STENTERING"),
  ],
  [false, true],
);

// ===========================================================================
console.log("\n--- 5. a stage with NO base: the restriction stands down ---");
// ===========================================================================
/* THE LIVE MASTER'S DAY-ONE STATE. There is no WASHING and no for_fabric
   PRINTING row, so 0563 seeds Washed and Printed with secondary steps only.
   Refusing everything there would make the stage unenterable. */
check(
  "LIVE: Washed has no base process at all",
  names(baseProcessesForStage(LIVE, WASHED)),
  [],
);
check(
  "…so its first step offers the stage's own list rather than nothing",
  offered(LIVE, { stageId: WASHED, isFirstOfStage: true }),
  ["COMPACTING [OPEN WIDTH]", "COMPACTING [TUBULAR]", "FABRIC PURCHASE", "STENTERING"],
);
refute(
  "…and specifically NOT an empty ▾, which the operator cannot work around",
  offered(LIVE, { stageId: WASHED, isFirstOfStage: true }),
  [],
);
check(
  "LIVE: Printed stands down the same way",
  offered(LIVE, { stageId: PRINTED, isFirstOfStage: true }),
  ["COMPACTING [OPEN WIDTH]", "COMPACTING [TUBULAR]", "FABRIC PURCHASE"],
);
check(
  "the stand-down does NOT widen the stage — KNITTING is still refused in Washed",
  offered(LIVE, { stageId: WASHED, isFirstOfStage: true }).includes("KNITTING"),
  false,
);
check(
  "a stage that DOES have a base is unaffected by the stand-down",
  offered(LIVE, { stageId: GREIGE, isFirstOfStage: true }),
  ["KNITTING"],
);

// ===========================================================================
console.log("\n--- 6. the base withheld by ANOTHER gate stands down too ---");
// ===========================================================================
/* DYEING is the Dyed stage's only base and carries 0557's `is_dyeing`, so on a
   Yarn-Dyed fabric it is already withheld — correctly: that fabric's dyeing
   loss is carried on the yarn side (0493). The Dyed ledger is still the right
   one for yarn-dyed cloth (§1 counts yarn dyeing as Dyed stock) and §3's other
   candidate base, YARN DYEING, is `for_yarn` and never offered here at all. So
   the operator must still be able to open the stage. */
check(
  "yarn-dyed: DYEING is withheld from Dyed (0557), as it always was",
  offered(FULL, { stageId: DYED, fabricIsYarnDyed: true }).includes("DYEING"),
  false,
);
refute(
  "yarn-dyed: opening the Dyed stage does NOT leave an empty ▾",
  offered(FULL, { stageId: DYED, isFirstOfStage: true, fabricIsYarnDyed: true }),
  [],
);
check(
  "yarn-dyed: the Dyed stage opens on its secondary steps instead",
  offered(FULL, { stageId: DYED, isFirstOfStage: true, fabricIsYarnDyed: true }),
  ["COMPACTING [OPEN WIDTH]", "COMPACTING [TUBULAR]", "FABRIC PURCHASE", "STENTERING"],
);
check(
  "not yarn-dyed: the same stage still forces DYEING",
  offered(FULL, { stageId: DYED, isFirstOfStage: true, fabricIsYarnDyed: false }),
  ["DYEING"],
);
check(
  "no print declared: PRINTING is withheld (0528), as it always was",
  offered(FULL, { stageId: PRINTED, printDeclared: false }).includes("PRINTING"),
  false,
);
refute(
  "no print declared: the Printed stage does NOT open on an empty ▾",
  offered(FULL, { stageId: PRINTED, isFirstOfStage: true, printDeclared: false }),
  [],
);
check(
  "print declared: the Printed stage forces PRINTING again",
  offered(FULL, { stageId: PRINTED, isFirstOfStage: true, printDeclared: true }),
  ["PRINTING"],
);

// ===========================================================================
console.log("\n--- 7. an UNCLASSIFIED process is offered in EVERY stage ---");
// ===========================================================================
check(
  "FABRIC PURCHASE has no pairing at all",
  FABRIC_PURCHASE.stage_roles,
  [],
);
check(
  "…and is offered in all four stages",
  STAGES.map((s) => offered(LIVE, { stageId: s }).includes("FABRIC PURCHASE")),
  [true, true, true, true],
);
refute(
  "…and specifically NOT hidden everywhere, which would strand the operator",
  STAGES.map((s) => offered(LIVE, { stageId: s }).includes("FABRIC PURCHASE")),
  [false, false, false, false],
);
check(
  "`stageAllowsProcess` says the same thing directly",
  STAGES.map((s) => stageAllowsProcess(FABRIC_PURCHASE, s)),
  [true, true, true, true],
);
check(
  "being unclassified does NOT override for_fabric — GARMENT DYEING stays out",
  STAGES.map((s) => offered(LIVE, { stageId: s }).includes("GARMENT DYEING")),
  [false, false, false, false],
);
check(
  "the inline twin is silent on an unclassified process in any stage",
  STAGES.map((s) => stageMismatchBlocked(row(s, FABRIC_PURCHASE.id), LIVE)),
  [false, false, false, false],
);

// ===========================================================================
console.log("\n--- 8. a held value always survives, and the twin says why ---");
// ===========================================================================
/* AGENTS.md "Disabled rows": dropping the value a row already holds shows a
   filled field as empty and blanks the FK on the next save. */
check(
  "a row holding DYEING under Greige keeps it on the list",
  offered(LIVE, { stageId: GREIGE, currentValue: DYEING.id }).includes("DYEING"),
  true,
);
check(
  "…without widening the stage for anything else",
  offered(LIVE, { stageId: GREIGE, currentValue: DYEING.id }),
  ["DYEING", "FABRIC PURCHASE", "HEAT SETTING", "KNITTING"],
);
check(
  "…and the inline twin names it as showing a value the stage disallows",
  stageMismatchBlocked(row(GREIGE, DYEING.id), LIVE),
  true,
);
check(
  "the twin is silent when the same process sits in a stage that allows it",
  stageMismatchBlocked(row(DYED, DYEING.id), LIVE),
  false,
);
check(
  "a held value survives the FIRST-STEP restriction too",
  offered(FULL, { stageId: GREIGE, isFirstOfStage: true, currentValue: HEAT_SETTING.id }),
  ["HEAT SETTING", "KNITTING"],
);
check(
  "the twin is silent on a row with no stage or no process yet",
  [
    stageMismatchBlocked(row(null, DYEING.id), LIVE),
    stageMismatchBlocked(row(GREIGE, null), LIVE),
  ],
  [false, false],
);
check(
  "an unresolvable process id is not reported as a stage mismatch",
  stageMismatchBlocked(row(GREIGE, "p-deleted-from-the-master"), LIVE),
  false,
);

// ===========================================================================
console.log("\n--- 9. `baseProcessMissing` — the first-step twin ---");
// ===========================================================================
check(
  "a route opening Greige with HEAT SETTING is named",
  baseProcessMissing([row(GREIGE, HEAT_SETTING.id)], 0, FULL),
  true,
);
check(
  "…and opening it with KNITTING is not",
  baseProcessMissing([row(GREIGE, KNITTING.id)], 0, FULL),
  false,
);
check(
  "only the row that OPENS the stage is judged — the second is not",
  baseProcessMissing([row(GREIGE, KNITTING.id), row(GREIGE, HEAT_SETTING.id)], 1, FULL),
  false,
);
check(
  "a later stage is judged on its own first row",
  [
    baseProcessMissing([row(GREIGE, KNITTING.id), row(DYED, STENTERING.id)], 1, FULL),
    baseProcessMissing([row(GREIGE, KNITTING.id), row(DYED, DYEING.id)], 1, FULL),
  ],
  [true, false],
);
check(
  "an unfilled opener holds the stage: the filled second row is not the opener",
  baseProcessMissing([row(DYED, null), row(DYED, STENTERING.id)], 1, FULL),
  false,
);
check(
  "silent on a stage with no base at all (LIVE Washed / Printed)",
  [
    baseProcessMissing([row(WASHED, STENTERING.id)], 0, LIVE),
    baseProcessMissing([row(PRINTED, COMPACTING_OW.id)], 0, LIVE),
  ],
  [false, false],
);
check(
  "silent when every base is withheld: yarn-dyed fabric opening Dyed",
  baseProcessMissing([row(DYED, STENTERING.id)], 0, FULL, { fabricIsYarnDyed: true }),
  false,
);
refute(
  "…and NOT silent on the same row when the fabric is not yarn-dyed",
  baseProcessMissing([row(DYED, STENTERING.id)], 0, FULL, { fabricIsYarnDyed: false }),
  false,
);
check(
  "silent when the base is withheld by printDeclared: Printed with no AOP",
  baseProcessMissing([row(PRINTED, DIP_WASHING.id)], 0, FULL, { printDeclared: false }),
  false,
);
refute(
  "…and NOT silent once the print is declared",
  baseProcessMissing([row(PRINTED, DIP_WASHING.id)], 0, FULL, { printDeclared: true }),
  false,
);
check(
  "silent on a row with no stage or no process",
  [
    baseProcessMissing([row(null, KNITTING.id)], 0, FULL),
    baseProcessMissing([row(GREIGE, null)], 0, FULL),
  ],
  [false, false],
);

// ===========================================================================
console.log("\n--- 10. THE TWINS NEVER CONTRADICT THE NARROWING ---");
// ===========================================================================
/* `baseProcessMissing` MIRRORS the flag test in `processesForFabric` rather
   than importing it (sharing it the other way would be a runtime import
   cycle — see `stage-routes.ts`'s header). This section is what holds the
   mirror in place: every combination of stage, both gates and both first-step
   settings, over every process the narrowing actually offered. A twin that
   warns about a row the rule permitted fails HERE. */
let pairs = 0;
const contradictions: string[] = [];
/* CLASSIFIED and FINISHED are in the matrix deliberately: the floor added in
   section 12 is a fail-OPEN guard, and a fail-open guard is exactly the kind
   that makes a twin start contradicting the ▾. */
for (const master of [LIVE, FULL, CLASSIFIED, M583]) {
  const label =
    master === LIVE ? "LIVE" : master === FULL ? "FULL" : master === CLASSIFIED ? "CLASSIFIED" : "M583";
  for (const stageId of [...STAGES, FINISHED]) {
    for (const printDeclared of [true, false]) {
      for (const fabricIsYarnDyed of [true, false]) {
        for (const isFirstOfStage of [true, false]) {
         /* 2026-09-19 — the positional purchase gate is a fourth dimension:
            the twins must agree with the ▾ whether or not a purchase may
            still go on this row. */
         for (const routeStartAllowed of [true, false]) {
          const gates = { printDeclared, fabricIsYarnDyed, routeStartAllowed };
          const list = processesForFabric(master, { stageId, isFirstOfStage, ...gates });
          for (const p of list) {
            pairs++;
            const r = row(stageId, p.id);
            if (!routeStartAllowed && isRouteStart(p)) {
              contradictions.push(`${label} stage=${stageId}: offered ${p.name} below Step 1`);
            }
            if (stageMismatchBlocked(r, master, gates)) {
              contradictions.push(
                `${label} stage=${stageId} print=${printDeclared} yd=${fabricIsYarnDyed} buy=${routeStartAllowed}` +
                  ` first=${isFirstOfStage}: offered ${p.name} but stageMismatchBlocked says no`,
              );
            }
            if (
              isFirstOfStage &&
              baseProcessMissing([r], 0, master, gates)
            ) {
              contradictions.push(
                `${label} stage=${stageId} print=${printDeclared} yd=${fabricIsYarnDyed}:` +
                  ` offered ${p.name} as a first step but baseProcessMissing says no`,
              );
            }
          }
         }
        }
      }
    }
  }
}
check(`the twins agree with the narrowing over all ${pairs} offered pairs`, contradictions, []);

/* THE OTHER DIRECTION. Agreement is cheap if the twins simply never fire, so
   this asserts they DO — every classified process, in every stage it does not
   name, is reported. */
let reported = 0;
const missed: string[] = [];
for (const p of FULL.filter((p) => p.for_fabric && p.stage_roles.length)) {
  for (const stageId of STAGES) {
    if (p.stage_roles.some((r) => r.stage_id === stageId)) continue;
    if (stageMismatchBlocked(row(stageId, p.id), FULL)) reported++;
    else missed.push(`${p.name} in ${stageId}`);
  }
}
check("every classified process IS reported in a stage it does not name", missed, []);
refute("…and that is not a vacuous zero", reported, 0);

// ===========================================================================
console.log("\n--- 11. `narrowToStage` / `baseProcessesForStage` directly ---");
// ===========================================================================
check(
  "narrowToStage with no stage returns the list untouched",
  names(narrowToStage(FULL, {})),
  names(FULL),
);
check(
  "narrowToStage does NOT apply the for_fabric gate itself",
  narrowToStage(FULL, {}).some((p) => p.name === "GARMENT DYEING"),
  true,
);
check(
  "baseProcessesForStage(null) is empty, not everything",
  names(baseProcessesForStage(FULL, null)),
  [],
);
check(
  "baseProcessesForStage returns the base of each of the four stages",
  STAGES.map((s) => names(baseProcessesForStage(FULL, s))),
  [["KNITTING"], ["DYEING"], ["WASHING"], ["PRINTING"]],
);
check(
  "…and reports LIVE's two baseless stages honestly rather than standing down",
  STAGES.map((s) => names(baseProcessesForStage(LIVE, s))),
  [["KNITTING"], ["DYEING"], [], []],
);

// ===========================================================================
console.log("\n--- 12. THE FLOOR: a stage nothing is classified against ---");
// ===========================================================================
/* THE STAND-DOWN ONE LEVEL UP. A stage with no pickable BASE falls back to its
   own allowed list (section 5); a stage with no pickable PROCESS AT ALL falls
   back to the whole gated list. Same sentence, same reason: when the rule knows
   nothing about a stage it says nothing about it.

   REACHED BY TWO ORDINARY OPERATOR ACTIONS, not by a contrived fixture —
   classify FABRIC PURCHASE to Greige (correct: it is §2's greige entry), then
   inline-create a stage on the Stage cell's picker (which is how WASH and PRINT
   got here). Without the floor the ▾ comes back EMPTY under a cell the screen
   marks `required`, and the operator has a mandatory field with no satisfying
   value — fillable by nothing, un-Tabbable, reachable only by Escape or
   Ctrl+Del. */
check(
  "the precondition is real: nothing for_fabric is unclassified any more",
  CLASSIFIED.filter((p) => p.for_fabric && !p.stage_roles.length).map((p) => p.name),
  [],
);
check(
  "…and no process is classified against the new stage",
  CLASSIFIED.filter((p) => p.stage_roles.some((r) => r.stage_id === FINISHED)).map((p) => p.name),
  [],
);
refute(
  "the Process ▾ is NOT empty — the mandatory cell stays fillable",
  offered(CLASSIFIED, { stageId: FINISHED }),
  [],
);
check(
  "…it falls back to the whole for_fabric list",
  offered(CLASSIFIED, { stageId: FINISHED }),
  names(CLASSIFIED.filter((p) => p.for_fabric)),
);
refute(
  "…and the FIRST step of that stage is not empty either",
  offered(CLASSIFIED, { stageId: FINISHED, isFirstOfStage: true }),
  [],
);
check(
  "an out-of-master process is still not conjured — for_fabric still holds",
  offered(CLASSIFIED, { stageId: FINISHED }).includes("GARMENT DYEING"),
  false,
);
/* THE FLOOR MUST NOT LEAK INTO A STAGE THAT IS CLASSIFIED. This is the whole
   risk of a fail-open guard: widening the one case must not widen the rest. */
check(
  "the floor does NOT widen Greige — DYEING is still refused there",
  offered(CLASSIFIED, { stageId: GREIGE }).includes("DYEING"),
  false,
);
check(
  "…nor Dyed — KNITTING is still refused, §1's headline case is untouched",
  offered(CLASSIFIED, { stageId: DYED }).includes("KNITTING"),
  false,
);
check(
  "…and Greige still opens on KNITTING alone",
  offered(CLASSIFIED, { stageId: GREIGE, isFirstOfStage: true }),
  ["KNITTING"],
);
check(
  "classifying FABRIC PURCHASE removes it from the other three stages",
  [DYED, WASHED, PRINTED].map((s) => offered(CLASSIFIED, { stageId: s }).includes("FABRIC PURCHASE")),
  [false, false, false],
);
/* AND THE TWIN GOES SILENT IN STEP, or it would report every row the widened
   list just offered — the contradiction section 10 exists to refuse. */
check(
  "the twin is silent for every process in the floored stage",
  CLASSIFIED.filter((p) => p.for_fabric)
    .filter((p) => stageMismatchBlocked(row(FINISHED, p.id), CLASSIFIED))
    .map((p) => p.name),
  [],
);
check(
  "…while still reporting a mismatch in a stage that IS classified",
  stageMismatchBlocked(row(GREIGE, DYEING.id), CLASSIFIED),
  true,
);
check(
  "`baseProcessMissing` is silent in the floored stage too",
  CLASSIFIED.filter((p) => p.for_fabric)
    .filter((p) => baseProcessMissing([row(FINISHED, p.id)], 0, CLASSIFIED))
    .map((p) => p.name),
  [],
);

// ===========================================================================
console.log("\n--- 13. the client's three route rules (2026-09-19) ---");
// ===========================================================================
/* Each Save-level vector asserts WHICH sentence spoke, not how many — a count
   passes against the wrong rule (see check-standard-routes' RULE table). */
const STAGE_ROWS = [
  { id: GREIGE, code: "grey", name: "GREIGE" },
  { id: DYED, code: "dyed", name: "DYED" },
  { id: WASHED, code: "WASH", name: "WASH" },
  { id: PRINTED, code: "PRINT", name: "PRINT" },
];
const problems = (rows: FabricProcessRow[], yarnDyed = false) =>
  stageRouteProblems(rows, M583, STAGE_ROWS, {
    gatesFor: () => ({ fabricIsYarnDyed: yarnDyed }),
  }).map((p) => p.message);
const said = (rows: FabricProcessRow[], phrase: string, yarnDyed = false) =>
  problems(rows, yarnDyed).filter((m) => m.includes(phrase)).length;

/* ---- Rule 1: no fabric dyeing on a yarn-dyed fabric -------------------- */
check(
  "R1 ▾: DYEING and DYEING [WITH BIOWASH] are withheld on a yarn-dyed fabric",
  processPickerItems(processesForFabric(M583, { fabricIsYarnDyed: true }))
    .map((i) => i.name)
    .filter((n) => n.startsWith("DYEING")),
  [],
);
check(
  "R1 ▾: …and both are offered on any other fabric",
  processPickerItems(processesForFabric(M583, {}))
    .map((i) => i.name)
    .filter((n) => n.startsWith("DYEING"))
    .sort(),
  ["DYEING", "DYEING [WITH BIOWASH]"],
);
check("R1 twin: a held DYEING on a yarn-dyed fabric is named", dyeingBlocked(row(DYED, DYEING_0583.id), M583, true), true);
check(
  "R1 Save: a yarn-dyed route holding DYEING is refused with the client's sentence",
  said([row(GREIGE, KNITTING.id), row(DYED, DYEING_0583.id)], "Fabric Dyeing steps cannot be added", true),
  1,
);
check(
  "R1 Save: the same route on a solid fabric is clean",
  problems([row(GREIGE, KNITTING.id), row(DYED, DYEING_0583.id)], false),
  [],
);
check(
  "R1 is the PROCESS, not the stage: yarn-dyed rolls BOUGHT dyed still save",
  problems([row(DYED, DYED_FABRIC_PURCHASE.id), row(DYED, STENTERING.id)], true),
  [],
);

/* ---- Rule 2: a purchase is Step 1 ------------------------------------ */
check("R2 position: the first row may buy", routeStartAllowedAt([], 0), true);
check(
  "R2 position: a BLANK row above does not make it Step 2",
  routeStartAllowedAt([row(null, null)], 1),
  true,
);
check("R2 position: a filled row above does", routeStartAllowedAt([row(GREIGE, KNITTING.id)], 1), false);
check(
  "R2 ▾: neither purchase is offered below Step 1",
  offered(M583, { routeStartAllowed: false }).filter((n) => n.includes("PURCHASE")),
  [],
);
check(
  "R2 ▾: both are offered on Step 1",
  offered(M583, {}).filter((n) => n.includes("PURCHASE")),
  ["DYED FABRIC PURCHASE", "FABRIC PURCHASE"],
);
check(
  "R2 ▾: a Dyed stage opened on row 3 offers DYEING alone as its base",
  offered(M583, { stageId: DYED, isFirstOfStage: true, routeStartAllowed: false }),
  ["DYEING"],
);
{
  const yd = offered(M583, {
    stageId: DYED,
    isFirstOfStage: true,
    routeStartAllowed: false,
    fabricIsYarnDyed: true,
  });
  check(
    "R2 ▾: …and on a yarn-dyed fabric, with no base left, stands down to the stage's list",
    yd,
    ["COMPACTING [OPEN WIDTH]", "COMPACTING [TUBULAR]", "STENTERING"],
  );
}
/* THIS ROUTE IS A FAULT SINCE 2026-09-20 (user decision: a yarn-dyed fabric
   enters DYED only as a dyed-roll purchase) — but the point of this vector
   stands: it must NOT be asked for a purchase it may not hold on row 2. */
check(
  "R2 Save: that yarn-dyed route (Dyed opened by STENTERING on row 2) is NOT asked for a purchase",
  problems([row(GREIGE, KNITTING.id), row(DYED, STENTERING.id)], true).filter((m) => m.includes("route opens with")),
  [],
);
check(
  "…it is refused by the yarn-dyed DYED-stage rule instead",
  problems([row(GREIGE, KNITTING.id), row(DYED, STENTERING.id)], true).map((m) => m.includes("never enters the DYED stage")),
  [true],
);
check(
  "R2 Save: on a solid fabric the base twin names DYEING only, never the purchase",
  problems([row(GREIGE, KNITTING.id), row(DYED, STENTERING.id)], false).map((m) =>
    m.includes("route opens with DYEING —") && !m.includes("PURCHASE"),
  ),
  [true],
);
check(
  "R2 Save: a purchase below Knitting is refused with the client's sentence",
  said(
    [row(GREIGE, KNITTING.id), row(GREIGE, FABRIC_PURCHASE_0583.id)],
    "must be the initial procurement step (Step 1)",
  ),
  1,
);
check(
  "R2 twin and position test are one rule",
  clothPurchaseNotFirst([row(GREIGE, KNITTING.id), row(GREIGE, FABRIC_PURCHASE_0583.id)], 1, M583),
  !routeStartAllowedAt([row(GREIGE, KNITTING.id)], 1),
);

/* ---- Rule 3: once per STAGE ------------------------------------------- */
{
  const r = [row(DYED, DYEING_0583.id), row(DYED, STENTERING.id), row(DYED, null)];
  check(
    "R3 ▾: a new Dyed row greys what the Dyed rows above hold",
    [...processesUsedInStage(r, 2)].sort(),
    [DYEING_0583.id, STENTERING.id].sort(),
  );
  check(
    "R3 ▾: a row's OWN value is not in its used set",
    processesUsedInStage(r, 1).has(STENTERING.id),
    false,
  );
}
check(
  "R3 ▾: a PRINT row greys nothing the Dyed rows hold",
  [...processesUsedInStage([row(DYED, COMPACTING_OW.id), row(PRINTED, null)], 1)],
  [],
);
check("R3 ▾: a row with no stage yet greys nothing", [...processesUsedInStage([row(DYED, STENTERING.id), row(null, null)], 1)], []);
{
  /* THE FLOOR: a blank row opening Dyed (row 2, so no purchase) whose only
     base a row BELOW already holds — greying it would leave a required cell
     with nothing to pick. */
  const r = [row(GREIGE, KNITTING.id), row(DYED, null), row(DYED, DYEING_0583.id)];
  const opts = processesForFabric(M583, { stageId: DYED, isFirstOfStage: true, routeStartAllowed: false });
  check("R3 floor: the ▾ there is DYEING alone", names(opts), ["DYEING"]);
  check("R3 floor: …so nothing is greyed on the blank row", [...processesUsedInStage(r, 1, opts)], []);
  check(
    "R3 floor: a FILLED row is not caged, so its taken alternatives still grey",
    [...processesUsedInStage([row(DYED, STENTERING.id), row(DYED, DYEING_0583.id)], 0, opts)],
    [DYEING_0583.id],
  );
}
{
  const twice = [row(DYED, DYEING_0583.id), row(DYED, STENTERING.id), row(DYED, STENTERING.id)];
  check("R3 twin: the SECOND Stentering is the repeat", processRepeatedInStage(twice, 2), true);
  check("R3 twin: …and the first is not", processRepeatedInStage(twice, 1), false);
  check(
    "R3 Save: Stentering twice under Dyed is refused with the once-per-stage sentence",
    said(twice, "A stage runs each process once"),
    1,
  );
}
check(
  "R3: COMPACTING under DYED and again under PRINT is NOT a repeat (chains 2 and 4)",
  problems([
    row(GREIGE, KNITTING.id),
    row(DYED, DYEING_0583.id),
    row(DYED, COMPACTING_OW.id),
    row(PRINTED, PRINTING.id),
    row(PRINTED, COMPACTING_OW.id),
  ]),
  [],
);
{
  /* A BASE repeated keeps its sharper sentence — one message for the row. */
  const dyedTwice = [row(DYED, DYEING_0583.id), row(DYED, DYEING_0583.id)];
  check("R3: a repeated BASE is still reported by baseProcessRepeated", baseProcessRepeated(dyedTwice, 1, M583), true);
  check(
    "R3: …with its own sentence, and the generic one stands down",
    problems(dyedTwice).map((m) => (m.includes("already moved this fabric into") ? "base" : m)),
    ["base"],
  );
}

// ===========================================================================
console.log("\n--- 14. Knitting is Step 1 only; a yarn-dyed fabric's DYED stage (client 2026-09-20) ---");
// ===========================================================================
{
  /* ---- A route START: FABRIC PURCHASE and KNITTING, Step 1 only -------- */
  check("KNITTING is a route start (the master's is_knitting flag)", isRouteStart(KNITTING), true);
  check("HEAT SETTING is not", isRouteStart(HEAT_SETTING), false);
  check(
    "Step 1 of GREIGE offers both route starts",
    offered(M583, { stageId: GREIGE, isFirstOfStage: true }),
    ["FABRIC PURCHASE", "KNITTING"],
  );
  check(
    "Step 2+ of GREIGE offers neither — only its sub-processes",
    offered(M583, { stageId: GREIGE, routeStartAllowed: false }),
    /* This fixture classifies COMPACTING to DYED/WASH/PRINT only, so HEAT
       SETTING is Greige's one sub-process here. */
    ["HEAT SETTING"],
  );
  const knitAfterBuy = [row(GREIGE, FABRIC_PURCHASE_0583.id), row(GREIGE, KNITTING.id)];
  check("KNITTING below a FABRIC PURCHASE is not Step 1", routeStartNotFirst(knitAfterBuy, 1, M583), true);
  check(
    "…and Save refuses it with the client's sentence, naming the step",
    said(knitAfterBuy, "Step 2: 'KNITTING' can only be defined as the initial step (Step 1)."),
    1,
  );
  check(
    "a purchase below Knitting keeps its own (procurement) sentence",
    said([row(GREIGE, KNITTING.id), row(GREIGE, FABRIC_PURCHASE_0583.id)], "initial procurement step (Step 1)"),
    1,
  );
  check(
    "KNITTING then HEAT SETTING is clean",
    problems([row(GREIGE, KNITTING.id), row(GREIGE, HEAT_SETTING.id)]),
    [],
  );
}
{
  /* ---- A yarn-dyed fabric enters DYED only as a dyed-roll purchase ------ */
  const names2 = (xs: readonly { name: string }[]) => xs.map((x) => x.name);
  const blank = (stage: string | null) => row(stage, null);
  check(
    "YD, Step 1: DYED is offered (that row may be the dyed purchase)",
    names2(stagesForRow(STAGE_ROWS, [blank(null)], 0, { fabricIsYarnDyed: true, options: M583 })).includes("DYED"),
    true,
  );
  check(
    "YD, after Knitting: DYED is withheld, WASH is offered",
    names2(
      stagesForRow(STAGE_ROWS, [row(GREIGE, KNITTING.id), blank(null)], 1, { fabricIsYarnDyed: true, options: M583 }),
    ),
    ["GREIGE", "WASH", "PRINT"],
  );
  check(
    "a SOLID fabric after Knitting still gets DYED",
    names2(stagesForRow(STAGE_ROWS, [row(GREIGE, KNITTING.id), blank(null)], 1, { options: M583 })).includes("DYED"),
    true,
  );
  check(
    "YD route that OPENED with DYED FABRIC PURCHASE keeps DYED for its finishing",
    names2(
      stagesForRow(STAGE_ROWS, [row(DYED, DYED_FABRIC_PURCHASE.id), blank(null)], 1, {
        fabricIsYarnDyed: true,
        options: M583,
      }),
    ).includes("DYED"),
    true,
  );
  const ydStenter = [row(GREIGE, KNITTING.id), row(DYED, STENTERING.id)];
  check("YD: STENTERING under DYED after Knitting is named inline", yarnDyedStageBlocked(ydStenter, 1, M583, STAGE_ROWS, true), true);
  check("…the same route on a SOLID fabric is not", yarnDyedStageBlocked(ydStenter, 1, M583, STAGE_ROWS, false), false);
  check("…and Save refuses it (the YD stage rule, not the base rule)", said(ydStenter, "never enters the DYED stage", true), 1);
  check(
    "YD: KNITTING → WASHING → STENTERING (standard chain 5) is clean",
    problems([row(GREIGE, KNITTING.id), row(WASHED, WASHING.id), row(WASHED, STENTERING.id)], true),
    [],
  );
  check(
    "YD bought as dyed rolls: DYED FABRIC PURCHASE → STENTERING under DYED is clean",
    problems([row(DYED, DYED_FABRIC_PURCHASE.id), row(DYED, STENTERING.id)], true),
    [],
  );
}

console.log(
  failed === 0 ? "\nOK — every fabric stage-route vector holds." : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
