/**
 * Vectors for the FIVE STANDARD PROCESS ROUTES (0570) —
 * `lib/orders/fabric-bom/standard-routes.ts`, client spec 2026-09-18 §3.
 *
 * ## 1. WHAT THIS CHECKS THAT `check-fabric-stage-routes` CANNOT
 *
 * That one asks whether a (stage, process) PAIR is judged correctly. This one
 * asks whether the five routes the factory actually runs can be ENTERED at all
 * — every step offered by the picker, in order, with no rule objecting.
 *
 * The distinction is the whole reason this file exists. On 2026-09-16, 0563
 * shipped the pair rule and seeded it by matching process NAMES; four of its
 * fifteen patterns (`washing`, `printing`, `%dip%wash%`, `%gum%cutting%`)
 * matched nothing, because those processes were not in the master. Every pair
 * vector passed. The Washed and Printed stages had secondary steps and NO BASE,
 * and **four of these five chains were impossible to enter** — invisible for
 * two days, because every layer of the rule fails open by design and the
 * operator just saw a working dropdown. Section 4 below is the assertion that
 * would have failed on the day.
 *
 * ## 2. THE FIXTURE IS THE MASTER AS 0570 LEAVES IT
 *
 * The live master before 0570 held 7 `for_fabric` processes (verified against
 * the database, 2026-09-18, not assumed from a note); 0570 adds WASHING, BIO
 * WASH, PRINTING, DIP-WASH and GUM CUTTING and classifies them, and classifies
 * FABRIC PURCHASE to Greige as a second base. So the fixture is twelve rows,
 * and section 6 pins each name to the migration that creates it — a chain that
 * names a process no migration creates fails HERE rather than silently seeding
 * nothing, which is precisely 0563's failure.
 *
 * ## 3. CHAIN 5 IS THE POINT OF THE `side` FIELD
 *
 * `[DYED] Yarn Dyeing → [GREY] Knitting` is not a backwards transition: a
 * step's stage names the ledger of its own material, and cloth knitted from
 * dyed yarn is still greige cloth. Section 5 asserts both halves — the fabric
 * side of chain 5 is clean, and its yarn steps are `for_yarn` so they can never
 * reach a fabric route in the first place.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  STANDARD_FABRIC_ROUTES,
  fabricSteps,
  processMatchesStep,
  standardRouteFor,
  type StandardStage,
} from "../lib/orders/fabric-bom/standard-routes.ts";
import {
  narrowToStage,
  stageRank,
  stageRouteProblems,
  type FabricProcessOption,
  type FabricProcessRow,
  type FabricStageLike,
} from "../lib/orders/fabric-bom/processes.ts";

const NL = String.fromCharCode(10);
let failed = 0;
function check(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`ok    ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`);
  }
}

// ---------------------------------------------------------------------------
// The four stages, with this database's own spellings (an operator renamed
// 0492's `grey` row to GREIGE and added WASH / PRINT under their own codes).
// ---------------------------------------------------------------------------
const STAGE: Record<StandardStage, FabricStageLike> = {
  grey: { id: "s-grey", code: "grey", name: "GREIGE" },
  dyed: { id: "s-dyed", code: "dyed", name: "DYED" },
  wash: { id: "s-wash", code: "WASH", name: "WASH" },
  print: { id: "s-print", code: "PRINT", name: "PRINT" },
};
const STAGES: FabricStageLike[] = Object.values(STAGE);

function proc(
  id: string,
  name: string,
  roles: { stage_id: string; is_base: boolean }[],
  extra: Partial<Pick<FabricProcessOption, "for_fabric" | "is_print" | "is_dyeing">> = {},
): FabricProcessOption {
  return {
    id,
    code: null,
    name,
    inactive: false,
    for_fabric: extra.for_fabric ?? true,
    is_print: extra.is_print ?? false,
    is_dyeing: extra.is_dyeing ?? false,
    is_knitting: name === "KNITTING",
    stage_roles: roles,
  };
}
const base = (s: FabricStageLike) => ({ stage_id: s.id, is_base: true });
const also = (s: FabricStageLike) => ({ stage_id: s.id, is_base: false });

/* ---- the master as 0570 leaves it ---------------------------------------- */
const MASTER: FabricProcessOption[] = [
  proc("p-knit", "KNITTING", [base(STAGE.grey)]),
  proc("p-heat", "HEAT SETTING", [also(STAGE.grey)]),
  proc("p-fabbuy", "FABRIC PURCHASE", [base(STAGE.grey)]),
  proc("p-dye", "DYEING", [base(STAGE.dyed)], { is_dyeing: true }),
  proc("p-stent", "STENTERING", [also(STAGE.dyed), also(STAGE.wash)]),
  proc("p-comp-ow", "COMPACTING [OPEN WIDTH]", [
    also(STAGE.dyed),
    also(STAGE.wash),
    also(STAGE.print),
  ]),
  proc("p-comp-tub", "COMPACTING [TUBULAR]", [
    also(STAGE.dyed),
    also(STAGE.wash),
    also(STAGE.print),
  ]),
  // 0570's five.
  proc("p-wash", "WASHING", [base(STAGE.wash)]),
  proc("p-biowash", "BIO WASH", [also(STAGE.wash)]),
  proc("p-print", "PRINTING", [base(STAGE.print)], { is_print: true }),
  proc("p-dipwash", "DIP-WASH", [also(STAGE.print)]),
  proc("p-gum", "GUM CUTTING", [also(STAGE.print)]),
  // The yarn axis — never `for_fabric`, which is what keeps chain 5's yarn
  // steps off every fabric route however they are named (0557).
  proc("p-yarnbuy", "YARN PURCHASE", [], { for_fabric: false }),
  proc("p-yarndye", "YARN DYEING", [], { for_fabric: false }),
];

const byName = (name: string) => MASTER.find((p) => p.name === name)!;

/** One route row, as the grid holds it. */
function row(stage: FabricStageLike, processId: string, i: number): FabricProcessRow {
  return {
    key: `r${i}`,
    item_id: "fab-1",
    combo: null,
    component_id: null,
    stage_id: stage.id,
    process_id: processId,
    loss_for_id: null,
    loss_pct: "",
    type_id: null,
  };
}

/** Build a chain's fabric side as stored rows, choosing for each step the
 *  FIRST master row the picker actually offers for it — which is what makes
 *  section 4 a test of enterability rather than of my fixture. */
function rowsFor(routeKey: string): { rows: FabricProcessRow[]; unofferable: string[] } {
  const route = STANDARD_FABRIC_ROUTES.find((r) => r.key === routeKey)!;
  const rows: FabricProcessRow[] = [];
  const unofferable: string[] = [];
  for (const step of fabricSteps(route)) {
    const stage = STAGE[step.stage];
    const opensStage = !rows.some((r) => r.stage_id === stage.id);
    /* THE REAL NARROWING, gated as the screen gates it: `for_fabric` first
       (the grid's own filter), then the stage rules. `printDeclared` is true
       for every chain here — chains 2 and 4 declare an all-over print, and for
       1 · 3 · 5 no step names a print process at all. */
    const offered = narrowToStage(
      MASTER.filter((p) => p.for_fabric),
      { stageId: stage.id, isFirstOfStage: opensStage },
    ).filter((p) => processMatchesStep(p.name, step));
    if (!offered.length) {
      unofferable.push(`[${step.stage}] ${step.process}`);
      continue;
    }
    rows.push(row(stage, offered[0].id, rows.length));
  }
  return { rows, unofferable };
}

/* WHICH RULE SPOKE, NOT MERELY THAT ONE DID. Asserting a COUNT here passes
   against the wrong rule entirely: with the stage ranks switched off, the
   "DYED then GREIGE" vector below still reported exactly one problem — the
   base-process twin objecting to HEAT SETTING opening the Greige stage — so a
   `length === 1` vector called the irreversibility rule proven while it was
   disabled. Each rule therefore gets a distinguishing phrase from its own
   sentence. */
const RULE = {
  backwards: "cannot return to an earlier stage",
  repeated: "already moved this fabric into",
  pair: "does not run",
  base: "route opens with",
} as const;
function rulesFired(rows: FabricProcessRow[]): string[] {
  return stageRouteProblems(rows, MASTER, STAGES).map((p) => {
    const hit = (Object.keys(RULE) as (keyof typeof RULE)[]).find((k) =>
      p.message.includes(RULE[k]),
    );
    return hit ?? `UNRECOGNISED: ${p.message}`;
  });
}

console.log("\n--- 1. the five chains are declared, and keyed by what picks them ---\n");

check(
  "five routes, in the spec's order",
  STANDARD_FABRIC_ROUTES.map((r) => r.name),
  [
    "Solid / Piece-Dyed",
    "Solid / All-Over Print",
    "Melange / Wash",
    "Melange / Print",
    "Yarn-Dyed (YD) / Wash",
  ],
);
check("solid + no print picks chain 1", standardRouteFor("solid", false)?.key, "solid_piece_dyed");
check(
  "melange + print picks chain 4",
  standardRouteFor("melange", true)?.key,
  "melange_print",
);
/* A YARN-DYED FABRIC WITH AN ALL-OVER PRINT NAMES NO CHAIN, and that is the
   honest answer rather than a fifth-and-a-half route invented here: the client
   listed five, and YD + AOP is not one of them. A caller gets `null` and must
   let the operator route it by hand. */
check("yarn-dyed + print names no standard chain", standardRouteFor("yarn_dyed", true), null);

console.log("\n--- 2. the stage order, which is what forbids going backwards ---\n");

check("greige ranks 0", stageRank(STAGE.grey), 0);
check("dyed and wash are SIBLINGS at 1", [stageRank(STAGE.dyed), stageRank(STAGE.wash)], [1, 1]);
check("print ranks 2", stageRank(STAGE.print), 2);
/* An operator-invented stage is UNRANKED and therefore exempt — the module's
   standing fail-open call. A rank invented for it would put it somewhere in a
   sequence nobody declared. */
check(
  "a stage this rule does not know is unranked",
  stageRank({ id: "s-x", code: "FINISHED", name: "FINISHED" }),
  null,
);
check("…and the rename of 0492's row still reads as greige", stageRank({ id: "x", code: "grey", name: "GREIGE" }), 0);

console.log("\n--- 3. every step of every chain is OFFERED by the picker ---\n");

for (const route of STANDARD_FABRIC_ROUTES) {
  check(`${route.name}: every fabric step is offered`, rowsFor(route.key).unofferable, []);
}

console.log("\n--- 4. and no rule objects to the assembled route ---\n");

for (const route of STANDARD_FABRIC_ROUTES) {
  const { rows } = rowsFor(route.key);
  check(
    `${route.name}: no stage/process problem`,
    stageRouteProblems(rows, MASTER, STAGES).map((p) => p.message),
    [],
  );
  check(
    `${route.name}: ${fabricSteps(route).length} fabric steps entered`,
    rows.length,
    fabricSteps(route).length,
  );
}

console.log("\n--- 5. chain 5's yarn leg is the yarn axis, not a violation ---\n");

check(
  "YARN PURCHASE and YARN DYEING are not fabric processes",
  ["YARN PURCHASE", "YARN DYEING"].map((n) => byName(n).for_fabric),
  [false, false],
);
check(
  "…so a fabric route can never offer them",
  narrowToStage(
    MASTER.filter((p) => p.for_fabric),
    { stageId: STAGE.dyed.id },
  )
    .map((p) => p.name)
    .filter((n) => n.startsWith("YARN")),
  [],
);
/* THE REGRESSION THAT WOULD FIRE IF THE YARN STEP WERE ON THE FABRIC SIDE.
   Stated as a vector because it is the mistake the spec's own table invites:
   read chain 5 as one sequence and Knitting-after-Yarn-Dyeing is backwards. */
check(
  "a DYED row followed by a GREIGE row is refused BY THE FORWARD-ONLY RULE",
  rulesFired([
    row(STAGE.dyed, byName("DYEING").id, 0),
    row(STAGE.grey, byName("HEAT SETTING").id, 1),
  ]),
  ["backwards"],
);

console.log("\n--- 6. the pair rule still refuses what §1 names ---\n");

check(
  "Knitting under DYED is refused by the PAIR rule",
  rulesFired([row(STAGE.dyed, byName("KNITTING").id, 0)]),
  ["pair"],
);
check(
  "Dyeing under GREIGE is refused by the PAIR rule",
  rulesFired([row(STAGE.grey, byName("DYEING").id, 0)]),
  ["pair"],
);
/* THE PROCUREMENT LOCK (§2). Greige cloth booked as dyed is in the live data
   today — this is the assertion that it cannot be entered again. */
check(
  "FABRIC PURCHASE under DYED is refused by the PAIR rule (the procurement lock)",
  rulesFired([row(STAGE.dyed, byName("FABRIC PURCHASE").id, 0)]),
  ["pair"],
);
check(
  "…and under GREIGE it opens the route",
  stageRouteProblems([row(STAGE.grey, byName("FABRIC PURCHASE").id, 0)], MASTER, STAGES),
  [],
);
/* A WASH ROUTE OPENING ON STENTERING is what one live fabric does, because
   there was no WASHING to open it with. With 0570 applied it is refusable. */
check(
  "a WASH route opening on STENTERING is refused by the BASE rule",
  rulesFired([row(STAGE.wash, byName("STENTERING").id, 0)]),
  ["base"],
);

console.log("\n--- 7. every process a chain names is CREATED by a migration ---\n");

/* THIS IS 0563'S FAILURE, AS A CHECK. Its seed named four processes that do not
   exist and inserted nothing, silently. A chain may only name a process some
   migration creates — scanned from the migration text rather than from the
   database, so the check runs anywhere and fails before a deploy rather than
   after one. It cannot prove the migration has been APPLIED; that is what the
   Process master's Fabric Stages grid shows, and what section 3 would catch on
   the next run against a real master. */
const MIGRATIONS = join(import.meta.dirname ?? ".", "..", "supabase", "migrations");
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .join("\n")
  .toUpperCase();

const named = [...new Set(STANDARD_FABRIC_ROUTES.flatMap((r) => r.steps.map((s) => s.process)))];
check(
  "no chain names a process no migration creates",
  named.filter((n) => !sql.includes(`'${n}'`)),
  [],
);

console.log(NL + "--- 8. a stage is ENTERED ONCE (client rule 2, 2026-09-18) ---" + NL);

check(
  "DYEING twice under DYED is refused by the REPEAT rule",
  rulesFired([
    row(STAGE.dyed, byName("DYEING").id, 0),
    row(STAGE.dyed, byName("DYEING").id, 1),
  ]),
  ["repeated"],
);
check(
  "KNITTING three times under GREIGE reports the 2nd and 3rd only",
  rulesFired([
    row(STAGE.grey, byName("KNITTING").id, 0),
    row(STAGE.grey, byName("KNITTING").id, 1),
    row(STAGE.grey, byName("KNITTING").id, 2),
  ]),
  ["repeated", "repeated"],
);
/* THE CASE THE WIDE READING WOULD HAVE BROKEN, and it is the client's own:
   chains 2 and 4 compact in the coloured stage and AGAIN after printing. A
   "no process twice" rule would make both unenterable. */
check(
  "COMPACTING in DYED and again in PRINT is left alone",
  rulesFired([
    row(STAGE.dyed, byName("DYEING").id, 0),
    row(STAGE.dyed, byName("COMPACTING [TUBULAR]").id, 1),
    row(STAGE.print, byName("PRINTING").id, 2),
    row(STAGE.print, byName("COMPACTING [TUBULAR]").id, 3),
  ]),
  [],
);
check(
  "…and STENTERING twice in one stage is left alone (it is nobody's base)",
  rulesFired([
    row(STAGE.dyed, byName("DYEING").id, 0),
    row(STAGE.dyed, byName("STENTERING").id, 1),
    row(STAGE.dyed, byName("STENTERING").id, 2),
  ]),
  [],
);
/* Chain 2 and 4 in full, through the same assembler section 4 uses — the
   regression test for the rule above, stated as the route rather than as
   two rows. */
for (const key of ["solid_all_over_print", "melange_print"]) {
  const { rows } = rowsFor(key);
  check(`${key}: still clean with the repeat rule live`, rulesFired(rows), []);
}

console.log(
  failed === 0
    ? "\nOK — all five standard routes are enterable and the stage rules hold."
    : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
