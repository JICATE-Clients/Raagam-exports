/**
 * THE FIVE STANDARD PROCESS ROUTES — the client's own table, as data (0570).
 *
 * Client spec 2026-09-18 §3, and the thing `doc/order/fabriprocess.md` §4 was
 * pointing AT when it removed `S. No.` from the Process master: "step ordering
 * is automatically governed by the 5 Standard Process Routes … Manual serial
 * numbers are redundant and cause sequencing errors". The serial number went in
 * 0565; until this file the five routes it deferred to existed only in prose.
 *
 * ## WHY DECLARED HERE RATHER THAN IMPLIED BY THE STAGE RULES
 *
 * `./stage-routes.ts` answers "may this step happen here?" one row at a time —
 * which pairs are legal, and that a route only moves forward. It cannot answer
 * "is the route the factory actually runs enterable at all", and that is the
 * question that was failing: 0563 classified WASH and PRINT with secondary
 * steps and **no base process**, because WASHING and PRINTING did not exist in
 * the master, so four of these five chains could not be entered. Every stage
 * rule passed; the routes were simply impossible. A rule about rows cannot
 * catch a missing row.
 *
 * `scripts/check-standard-routes.mts` is the half that catches it: it walks
 * each chain through the real narrowing and asserts each step is offered, and
 * it cross-checks every process name here against the migrations, so a chain
 * naming a process nothing creates fails the check instead of shipping.
 *
 * ## THE TWO AXES, WHICH IS WHAT MAKES CHAIN 5 LEGAL
 *
 * Chain 5 reads `[DYED] Yarn Dyeing → [GREY] Knitting`, which looks like the
 * backwards transition §2 forbids and is not. A step's stage names the ledger
 * of ITS OWN material: yarn dyeing moves YARN into dyed yarn stock, and cloth
 * knitted from dyed yarn has never been dyed AS CLOTH — it is greige fabric,
 * which is exactly why that route later needs a WASH rather than a DYE.
 *
 * So `side` is on every step, and the irreversibility rule is evaluated over
 * the FABRIC side alone. The app already enforces the split at the master:
 * YARN PURCHASE and YARN DYEING are `for_yarn`, every fabric route is scoped
 * `for_fabric`, and 0557 withholds fabric dyeing from a yarn-dyed fabric. The
 * yarn steps are declared here anyway, because the chain is the client's unit
 * of thought and dropping half of it would make this file disagree with the
 * page they read it from — and the check asserts they are `for_yarn`, so this
 * cannot become a door into a fabric route.
 *
 * ## NAMES MATCH BY PREFIX, ON PURPOSE
 *
 * The master holds COMPACTING [OPEN WIDTH] and COMPACTING [TUBULAR]; the chain
 * says "Compacting", because which one runs is the finishing decision and both
 * satisfy the route. `processMatchesStep` is that comparison, and it is the same
 * shape the migrations' `ilike 'compacting%'` seeds use — one rule, stated in
 * SQL for classification and here for the route.
 */

/** The stage a step books its material into. Names, not ids: this file is a
 *  declaration, and ids differ per database (this one's greige row is coded
 *  `grey` and named GREIGE). `stageRank` maps either spelling. */
export type StandardStage = "grey" | "dyed" | "wash" | "print";

/** Which material the step acts on — see "THE TWO AXES" above. */
export type StandardSide = "yarn" | "fabric";

export type StandardRouteStep = {
  stage: StandardStage;
  /** The process master's own name, or its distinguishing prefix. */
  process: string;
  side: StandardSide;
};

export type StandardRoute = {
  key: string;
  /** The client's own name for the route. */
  name: string;
  /** How the cloth reaches colour, which is what picks the chain. */
  colourway: "solid" | "melange" | "yarn_dyed";
  /** Does the order declare an all-over print for it? */
  allOverPrint: boolean;
  steps: readonly StandardRouteStep[];
};

const YARN_PURCHASE: StandardRouteStep = { stage: "grey", process: "YARN PURCHASE", side: "yarn" };
const GREIGE_KNIT: readonly StandardRouteStep[] = [
  { stage: "grey", process: "KNITTING", side: "fabric" },
  { stage: "grey", process: "HEAT SETTING", side: "fabric" },
];
/* The all-over print tail — identical after a dye and after a wash, which is
   §1's "Post-print finishing (Dip-Wash, Compacting) remains tagged as PRINT". */
const PRINT_TAIL: readonly StandardRouteStep[] = [
  { stage: "print", process: "PRINTING", side: "fabric" },
  { stage: "print", process: "DIP-WASH", side: "fabric" },
  { stage: "print", process: "COMPACTING", side: "fabric" },
];

export const STANDARD_FABRIC_ROUTES: readonly StandardRoute[] = [
  {
    key: "solid_piece_dyed",
    name: "Solid / Piece-Dyed",
    colourway: "solid",
    allOverPrint: false,
    steps: [
      YARN_PURCHASE,
      ...GREIGE_KNIT,
      { stage: "dyed", process: "DYEING", side: "fabric" },
      { stage: "dyed", process: "STENTERING", side: "fabric" },
      { stage: "dyed", process: "COMPACTING", side: "fabric" },
    ],
  },
  {
    key: "solid_all_over_print",
    name: "Solid / All-Over Print",
    colourway: "solid",
    allOverPrint: true,
    steps: [
      YARN_PURCHASE,
      ...GREIGE_KNIT,
      { stage: "dyed", process: "DYEING", side: "fabric" },
      { stage: "dyed", process: "STENTERING", side: "fabric" },
      { stage: "dyed", process: "COMPACTING", side: "fabric" },
      ...PRINT_TAIL,
    ],
  },
  {
    key: "melange_wash",
    name: "Melange / Wash",
    colourway: "melange",
    allOverPrint: false,
    steps: [
      YARN_PURCHASE,
      ...GREIGE_KNIT,
      { stage: "wash", process: "WASHING", side: "fabric" },
      { stage: "wash", process: "STENTERING", side: "fabric" },
      { stage: "wash", process: "COMPACTING", side: "fabric" },
    ],
  },
  {
    key: "melange_print",
    name: "Melange / Print",
    colourway: "melange",
    allOverPrint: true,
    steps: [
      YARN_PURCHASE,
      ...GREIGE_KNIT,
      { stage: "wash", process: "WASHING", side: "fabric" },
      { stage: "wash", process: "STENTERING", side: "fabric" },
      { stage: "wash", process: "COMPACTING", side: "fabric" },
      ...PRINT_TAIL,
    ],
  },
  {
    key: "yarn_dyed_wash",
    name: "Yarn-Dyed (YD) / Wash",
    colourway: "yarn_dyed",
    allOverPrint: false,
    steps: [
      YARN_PURCHASE,
      /* THE YARN AXIS. Dyed yarn stock — and the cloth knitted from it is still
         greige, which is why the next step is GREY and not a violation. See
         "THE TWO AXES" in the header. */
      { stage: "dyed", process: "YARN DYEING", side: "yarn" },
      ...GREIGE_KNIT,
      { stage: "wash", process: "WASHING", side: "fabric" },
      { stage: "wash", process: "STENTERING", side: "fabric" },
      { stage: "wash", process: "COMPACTING", side: "fabric" },
    ],
  },
];

/**
 * Does this process-master row satisfy this step? Prefix, case-insensitive —
 * see "NAMES MATCH BY PREFIX" above, and note it is deliberately NOT a
 * substring test: "BIT PRINTING" must not answer for "PRINTING" (it is a
 * garment-side process), and a substring test would let it.
 */
export function processMatchesStep(processName: string, step: StandardRouteStep): boolean {
  return processName.trim().toUpperCase().startsWith(step.process.toUpperCase());
}

/** The chain a fabric should run, or `null` where the three inputs name none. */
export function standardRouteFor(
  colourway: StandardRoute["colourway"],
  allOverPrint: boolean,
): StandardRoute | null {
  return (
    STANDARD_FABRIC_ROUTES.find(
      (r) => r.colourway === colourway && r.allOverPrint === allOverPrint,
    ) ?? null
  );
}

/** Just the cloth's own steps — what the Fabric Process tab declares, and the
 *  only side the forward-only rule is evaluated over. */
export function fabricSteps(route: StandardRoute): StandardRouteStep[] {
  return route.steps.filter((s) => s.side === "fabric");
}
