/**
 * "WHERE DOES THIS CLOTH COME FROM?" — Default Rule No. 1 vs Default Rule No. 2
 * (`doc/order/fabriprocess.md` §2, client recording 2026-09-16), declared PER
 * FABRIC on `order_fabric_bom_process_scope` (0564).
 *
 * Client-safe on purpose (no `server-only`), exactly like `./processes.ts` and
 * `./yarn-process.ts` beside it: the screen previews the demand this changes
 * and the save path stores it, and those two must be one computation.
 *
 * ## THREE SOURCES, AND EACH ONE IS A DIFFERENT PLACE TO ENTER THE LADDER
 *
 * §1 of the spec is the reason this exists at all, and it is about STOCK
 * LEDGERS: greige, dyed, washed, printed. A fabric enters the factory at one
 * of them, and everything upstream of that point was somebody else's loss.
 *
 * - **`yarn_knit` — Default Rule 1.** Buy raw grey yarn, knit greige rolls,
 *   then dye / wash / print. The route runs whole. This is what every fabric
 *   in this database has always been, and it is the default here for that
 *   reason, not because it is the commonest answer.
 * - **`greige_purchase` — Default Rule 2.** The factory buys ready-knitted
 *   greige rolls from the market instead. "Selecting `Greige Fabric Purchase`
 *   disables and suppresses `Yarn Purchase` and `Knitting` in the calculation
 *   engine. On the Material Requirement Sheet, the demand shifts directly to
 *   Greige Fabric Roll Weight (in Kg) rather than raw grey yarn."
 * - **`dyed_purchase`.** Incoming finished dyed rolls: "the engine similarly
 *   suppresses both Greige Knitting and Dyeing steps, tracking incoming
 *   finished dyed rolls directly."
 *
 * ## SUPPRESSION, NOT A ZERO — AND THAT IS THE WHOLE TRAP
 *
 * A suppressed stage must LEAVE THE LADDER. It must never become a stage
 * carrying 0% loss, which is the shape this would most naturally be written
 * in and which changes *nothing*: the backward markup is `/(1 - L/100)`, so a
 * zero-loss step multiplies the factor by exactly 1 and the demand comes out
 * identical to Rule 1's. The screen would show a Source ▾ the operator had
 * set, the report would name the route, and the purchase weight would be the
 * un-suppressed one — a wrong figure wearing every sign of a right one. This
 * module has already shipped that exact shape once: the Component Wise route
 * that stacked seven stages instead of four and produced 1.201 where 1.107
 * was correct, indistinguishable on screen from a correct report.
 *
 * So the rule below REMOVES steps from the list, and every vector in
 * `scripts/check-fabric-bom-reports.mts` §9 asserts the STEP LIST as well as
 * the factor — a suppression that silently left a zero-loss step standing
 * would pass a factor assertion and fail those.
 *
 * ## IT SUPPRESSES A PROCESS, NEVER A STAGE — AND HEATSETTING IS WHY
 *
 * The obvious implementation is "drop the whole Greige stage", and it reads
 * well against §2's own sequence line. It is wrong, and expensively so: the
 * Greige stage also holds HEATSETTING (spec §3's table), which a factory
 * buying greige rolls may well still run in-house. Dropping it would remove a
 * real loss and UNDER-BUY the cloth — the direction that stops a line rather
 * than costing money. The spec names two processes, Knitting and Dyeing, and
 * this file suppresses exactly those two and nothing beside them. A fabric
 * that genuinely arrives heatset says so by not declaring a Heatsetting step.
 *
 * ## WHICH MEANS THE PROCESS MASTER HAS TO SAY WHICH STEP IS WHICH
 *
 * `processes.is_dyeing` already exists (0557) and `processes.is_knitting` is
 * added by 0564 in the identical shape — one operator-maintained flag, seeded
 * once from `for_fabric` processes already named KNIT, never re-derived from
 * the name at read time. 0557's own header says why a name match at read time
 * was rejected, and the same argument holds here: "KNIT" appears in Knitting
 * Dia, Flat Knitting and Knit Fabric Inspection, and only a flag can tell them
 * apart from the step that makes greige cloth.
 *
 * **A PROCESS NOBODY HAS FLAGGED SUPPRESSES NOTHING, AND THAT ERRS UPWARD.**
 * An unflagged Knitting step stays in a `greige_purchase` fabric's ladder, so
 * its greige demand is grossed by a knitting loss it should not carry — an
 * over-buy of a percent or two. The yarn half is not flag-dependent at all
 * (`yarnPurchase` skips the fabric outright), so the expensive half of Rule 2
 * cannot be defeated by an unticked checkbox. That asymmetry is deliberate:
 * where a missing flag has to fail, it fails by buying slightly too much
 * cloth, never by buying too little.
 */

/* `./stage-routes` imports nothing from here and only TYPES from `./processes`,
   so this adds no runtime cycle — the rule this file's structural types exist
   to protect. */
import { stageRank, type FabricStageLike } from "./stage-routes";

/** WHERE THIS FABRIC COMES FROM (§2) — Default Rule 1 vs Rule 2. */
export const FABRIC_SOURCES = ["yarn_knit", "greige_purchase", "dyed_purchase"] as const;
export type FabricSource = (typeof FABRIC_SOURCES)[number];

export const FABRIC_SOURCE_LABELS: Record<FabricSource, string> = {
  yarn_knit: "Yarn Purchase + Knitting",
  greige_purchase: "Greige Fabric Purchase",
  dyed_purchase: "Dyed Fabric Purchase",
};

/**
 * Which upstream steps this source SUPPRESSES from the demand engine.
 *
 * `yarnPurchase` is not a route step and never was — it is the whole yarn
 * side of the document (`yarnPurchase()` in `./yarn-process.ts`, the Yarn
 * Process tab, the Budget's "Yarn Purchase" section). A fabric bought as
 * cloth buys no yarn at all, so this is a flag about a SECTION rather than
 * about a stage, and it is stated here beside the other two because all three
 * are one client sentence.
 */
export function suppressedBySource(source: FabricSource): {
  yarnPurchase: boolean;
  knitting: boolean;
  dyeing: boolean;
} {
  switch (source) {
    case "greige_purchase":
      return { yarnPurchase: true, knitting: true, dyeing: false };
    case "dyed_purchase":
      return { yarnPurchase: true, knitting: true, dyeing: true };
    case "yarn_knit":
    default:
      /* THE DEFAULT IS THE WHOLE ROUTE, and the `default:` arm is not defensive
         padding: `source` arrives from a text column and from a Zod enum, and a
         value neither of them expected must read as Rule 1 — the behaviour
         every row in this database had before the column existed — never as
         "suppress everything", which would silently empty a ladder. */
      return { yarnPurchase: false, knitting: false, dyeing: false };
  }
}

/** Is this a real member of the enum? A text column can hold anything; a row
 *  written before 0564, or by a `lib/data-io` import, must land on Rule 1
 *  rather than on `undefined`. */
export function asFabricSource(v: unknown): FabricSource {
  return typeof v === "string" && (FABRIC_SOURCES as readonly string[]).includes(v)
    ? (v as FabricSource)
    : "yarn_knit";
}

/**
 * ONE ROUTE STEP, as much of it as the suppression rule reads — the two
 * process-master kind flags, carried on the step the same way `component_id`
 * came to be carried on it (2026-09-15). Both optional and both defaulting to
 * "not that kind", so every pre-0564 caller composes a route that suppresses
 * nothing and behaves exactly as it always has.
 */
export type SourceKindedStep = {
  is_knitting?: boolean | null;
  is_dyeing?: boolean | null;
};

/**
 * Does this source suppress this one step?
 *
 * SEPARATE FROM `routeForSource` BELOW so the screen can say WHY a declared
 * step is greyed rather than simply not costing it — the inline-twin idiom
 * `printBlocked` / `dyeingBlocked` establish in `./processes.ts`. A step the
 * engine silently drops and the screen still draws in full is the shape that
 * makes an operator distrust the figure rather than the route.
 */
export function stepSuppressedBySource(source: FabricSource, step: SourceKindedStep): boolean {
  const off = suppressedBySource(source);
  if (off.knitting && step.is_knitting) return true;
  if (off.dyeing && step.is_dyeing) return true;
  return false;
}

/**
 * The steps that still run once this fabric's source has had its say.
 *
 * ORDER IS PRESERVED and nothing is re-sorted, the same contract
 * `stagesForGroup` keeps: a caller that reversed the route for the backward
 * walk gets its reversed order back, minus the suppressed steps.
 *
 * GENERIC OVER THE STEP so it can filter a `RouteStage[]` without this file
 * importing `./yarn-process.ts` — the dependency runs the other way, and a
 * cycle between the rule and the arithmetic is how one of them ends up
 * re-stating the other.
 */
export function routeForSource<S extends SourceKindedStep>(
  stages: readonly S[],
  source: FabricSource,
): S[] {
  if (source === "yarn_knit") return [...stages];
  return stages.filter((s) => !stepSuppressedBySource(source, s));
}

/**
 * A STEP THE SOURCE HAS SWITCHED OFF, ANSWERED FROM A ROW — the screen's half
 * of `stepSuppressedBySource` above, and the client's own ruling on what
 * happens to work already typed (2026-09-16).
 *
 * ## THE RULING: DROP IT FROM THE ARITHMETIC, KEEP IT ON THE SCREEN
 *
 * A fabric's route says `Greige → Knitting`; the operator then switches that
 * fabric's Source to Greige Purchase. The Knitting row is now meaningless.
 * Three things were possible and only one of them was chosen:
 *
 * - **Delete the row.** Rejected: it destroys typed work for a toggle the
 *   operator may be trying out, and switching the source back would not bring
 *   it — or its loss % — back.
 * - **Refuse the Source change until the route is cleaned up.** Rejected: it
 *   makes the operator do the engine's arithmetic for it, and the thing they
 *   are being refused is the answer to a question the screen asked them.
 * - **Ignore it and say so.** Chosen. The step leaves the ladder entirely (it
 *   does NOT become a 0% stage — see this file's header on why that changes
 *   nothing), the row stays exactly where it was typed, drawn inert, with a
 *   line naming why.
 *
 * ## ONE ANSWER, TWO READERS, AND THAT IS THE WHOLE POINT OF PUTTING IT HERE
 *
 * The engine reads `routeForSource`; the screen reads this. Both bottom out in
 * `stepSuppressedBySource`, so a row drawn inert and a step dropped from the
 * arithmetic cannot disagree. A second copy of the predicate on the screen
 * side is how this module's last two silent-arithmetic bugs happened, and it
 * is the reason this function is here rather than in the grid.
 *
 * ## IT TAKES THE OPTIONS STRUCTURALLY, NOT AS `FabricProcessOption`
 *
 * `processes.ts` imports from `./yarn-process`, which imports from here, so an
 * import of `FabricProcessOption` would close a cycle. The shape below is what
 * `FabricProcessOption` already satisfies, so a caller passes its own options
 * array unchanged and nothing has to be converted. Same reason
 * `SourceKindedStep` is structural.
 *
 * SAME IDIOM AS `printBlocked` / `dyeingBlocked` in `./processes.ts`, which is
 * deliberate and is what a reader should recognise: named on screen, never a
 * toast, the held value never dropped.
 */
export function sourceSuppressedRow(
  row: { process_id?: string | null },
  options: readonly ({ id: string } & SourceKindedStep)[],
  source: FabricSource,
): boolean {
  if (!row.process_id) return false;
  const opt = options.find((p) => p.id === row.process_id);
  return !!opt && stepSuppressedBySource(source, opt);
}

/**
 * WHY this row is inert, in the words the screen prints under it — or null
 * when it is not.
 *
 * THE SENTENCE NAMES THE SOURCE AND THE FIX, never just the fact. "This step
 * is not counted" tells an operator that something is wrong without telling
 * them whether they did it; naming the Source ▾ they set, and saying the step
 * comes back if they change it, makes the inertness read as the consequence of
 * their own answer rather than as a defect in the row.
 *
 * It is stated HERE rather than in the grid for `sourceSuppressedRow`'s
 * reason: the screen must not be able to say a step is ignored for a reason
 * the engine does not hold.
 */
export function sourceSuppressedReason(
  row: { process_id?: string | null },
  options: readonly ({ id: string } & SourceKindedStep)[],
  source: FabricSource,
): string | null {
  if (!sourceSuppressedRow(row, options, source)) return null;
  /* NAMES THE ROUTE'S FIRST STEP, NOT A SOURCE ▾ (2026-09-19). The ▾ has been
     hidden since it shipped, so "change the Source back" pointed at a control
     nobody can see. The source is now read off the route (`sourceFromRoute`),
     so the fix the sentence offers is the one the operator can make here. */
  return (
    `Not counted — this route opens with ${FABRIC_SOURCE_LABELS[source]}, so this ` +
    "step is already done when the cloth arrives. The row is kept; change the " +
    "route's first step and it counts again."
  );
}

/* ==========================================================================
 * THE SOURCE IS READ OFF THE ROUTE (client 2026-09-19)
 *
 * "When a fabric stage is set to Dyed, the system must permit Direct Fabric
 * Purchase — purchasing dyed fabric directly without requiring raw yarn
 * purchasing or internal knitting."
 *
 * Everything above has known how to COST a bought roll since 0564. What was
 * missing was any way to SAY it: the Source ▾ that carries it is hidden
 * (`SHOW_FABRIC_SOURCE = false` on the screen), so every live
 * `order_fabric_bom_process_scope.source` is NULL and reads as Rule 1 — yarn
 * bought and knitted for cloth whose own route opens with FABRIC PURCHASE.
 * The route and the arithmetic were two answers to one question.
 *
 * Now the route IS the answer. A branch whose FIRST step is a cloth purchase
 * (`processes.is_cloth_purchase`, 0583) is bought, and the stage that step
 * sits in says as what: a Greige-stage purchase is greige rolls, a coloured
 * stage (Dyed / Wash / Print) is finished rolls. `clothPurchaseNotFirst`
 * (`./stage-routes.ts`) refuses a purchase anywhere but first, so "first step"
 * and "a purchase step" cannot mean different things.
 * ========================================================================== */

/** One route step, as much of it as the source derivation reads. Structural,
 *  for the cycle reason `SourceKindedStep` records. */
export type SourcedRouteStep = {
  item_id: string;
  combo?: string | null;
  component_id?: string | null;
  stage_id?: string | null;
  process_id?: string | null;
};

/** A branch's opening step, answered as a source — or null when the branch
 *  names no process yet (nothing to read). */
function branchSource(
  branch: readonly SourcedRouteStep[],
  options: readonly { id: string; is_cloth_purchase?: boolean }[],
  stages: readonly FabricStageLike[],
): FabricSource | null {
  const first = branch.find((r) => !!r.process_id);
  if (!first) return null;
  if (!options.find((p) => p.id === first.process_id)?.is_cloth_purchase) return "yarn_knit";
  const stage = stages.find((s) => s.id === first.stage_id);
  const rank = stage ? stageRank(stage) : null;
  /* AN UNRANKED OR BLANK STAGE BUYS NOTHING. Guessing "greige" or "dyed" for a
     stage the rule does not recognise would pick which steps leave the ladder
     on no evidence; Rule 1 over-buys by a known amount instead, and the
     Stage cell is `required` on a started row anyway. */
  if (rank === 0) return "greige_purchase";
  if (rank != null && rank >= 1) return "dyed_purchase";
  return "yarn_knit";
}

/**
 * WHEN A FABRIC'S BRANCHES DISAGREE ABOUT WHERE ITS CLOTH COMES FROM.
 *
 * A fabric's route can be split by colourway (and, for routes saved before
 * 2026-09-16, by component). Each branch opens on its own first step, so RED
 * can open with DYED FABRIC PURCHASE while WHITE opens with KNITTING. But
 * `source` is ONE fact per fabric — the yarn side (`yarnPurchase`) either buys
 * yarn for the fabric or skips it whole; it has no per-colourway switch.
 *
 * REFUSE — DECIDED 2026-09-19 (user, on the business case). Two alternatives
 * were weighed and rejected:
 *   - FALL BACK TO RULE 1 ("yarn_knit") would raise yarn requisitions for the
 *     colourway that is bought dyed, and the Budget would cost that cloth
 *     twice — once as yarn, once as the roll. Silent cost inflation.
 *   - MAJORITY / BY WEIGHT needs the requirement weights and still buys the
 *     wrong thing for the minority colourway.
 * A fabric whose colourways are procured differently is two fabrics in textile
 * practice (e.g. "SJ [Dyed – Direct]" vs "SJ [Grey – Knitted]"), so the Save
 * gate names the conflict and the merchandiser aligns the routes or splits the
 * fabric before the budget baseline is committed. Do not "soften" this into a
 * fallback without a new client decision.
 */
export function resolveFabricSource(
  branchSources: readonly FabricSource[],
): FabricSource | { refused: string } {
  const distinct = [...new Set(branchSources)];
  if (distinct.length === 0) return "yarn_knit";
  if (distinct.length === 1) return distinct[0];
  return {
    refused:
      "its route branches start differently — one is bought as cloth and another is knitted from yarn. " +
      "A fabric is either bought or knitted: start every colour's route the same way, or use a separate fabric",
  };
}

/**
 * EVERY FABRIC'S SOURCE, READ OFF ITS ROUTE — the one derivation the screen's
 * preview, the save action and the stored `order_fabric_bom_process_scope.source`
 * all take, so the figure previewed and the figure stored cannot come from two
 * readings of the route.
 *
 * Returns only fabrics whose route names at least one process. A fabric absent
 * from the map has no route to read, and its caller keeps whatever source it
 * already had (`effectiveFabricSource`).
 *
 * `rows` must be in route order (the order the grid shows and `sno` stores).
 */
export function sourceFromRoute(
  rows: readonly SourcedRouteStep[],
  options: readonly { id: string; is_cloth_purchase?: boolean }[],
  stages: readonly FabricStageLike[],
): Map<string, FabricSource | { refused: string }> {
  const branchesByItem = new Map<string, Map<string, SourcedRouteStep[]>>();
  for (const r of rows) {
    const byBranch = branchesByItem.get(r.item_id) ?? new Map<string, SourcedRouteStep[]>();
    branchesByItem.set(r.item_id, byBranch);
    /* Keyed the way `stageRouteProblems` keys a branch — an array encoding,
       so no separator byte is needed (see that function's note). */
    const key = JSON.stringify([r.combo ?? "", r.component_id ?? ""]);
    const at = byBranch.get(key);
    if (at) at.push(r);
    else byBranch.set(key, [r]);
  }
  const out = new Map<string, FabricSource | { refused: string }>();
  for (const [itemId, byBranch] of branchesByItem) {
    const sources = [...byBranch.values()]
      .map((b) => branchSource(b, options, stages))
      .filter((s): s is FabricSource => s !== null);
    if (sources.length) out.set(itemId, resolveFabricSource(sources));
  }
  return out;
}

/**
 * The source one fabric's figures are computed with: the route's answer when
 * the route has one, else what was stored (a route with no steps yet, or a
 * `lib/data-io` import). A refusal reads as Rule 1 for the ARITHMETIC — the
 * over-buy side — while the Save gate refuses the document on the same
 * refusal, so no figure computed this way is ever stored.
 */
export function effectiveFabricSource(
  stored: FabricSource,
  derived: FabricSource | { refused: string } | undefined,
): FabricSource {
  if (derived === undefined) return stored;
  return typeof derived === "string" ? derived : "yarn_knit";
}

/**
 * Does a fabric from this source buy YARN?
 *
 * The named reading of `suppressedBySource(source).yarnPurchase`, so the four
 * readers of that half (`yarnPurchase`, `deriveYarnRows`'s callers, the Yarn
 * & Fabric Requirement Report, the Budget's Yarn Purchase section) all ask the
 * question in the same words rather than each negating a boolean.
 */
export const sourceBuysYarn = (source: FabricSource): boolean =>
  !suppressedBySource(source).yarnPurchase;

/**
 * Does a fabric from this source buy CLOTH BY THE ROLL, and what does the
 * demand line call it?
 *
 * §2: "the demand shifts directly to Greige Fabric Roll Weight (in Kg)". The
 * UNIT is not a choice this function makes and is not returned here — every
 * `order_fabric_bom_requirements.required_qty` in this app is already a weight
 * in kilograms by construction (0562: a Manual entry states grams per garment
 * and the engine divides by 1,000), so the demand line's unit under Rule 2 is
 * the kilogram for the same reason it was under Rule 1. What changes is WHAT
 * IS BEING WEIGHED — rolls of cloth rather than cones of yarn — which is a
 * label and a section, not a conversion.
 */
export const sourceBuysCloth = (source: FabricSource): boolean => source !== "yarn_knit";

/** What the purchased-cloth demand line is headed with. Null for Rule 1,
 *  which raises no such line at all. */
export function clothPurchaseLabel(source: FabricSource): string | null {
  switch (source) {
    case "greige_purchase":
      return "Greige Fabric Roll Weight";
    case "dyed_purchase":
      return "Dyed Fabric Roll Weight";
    default:
      return null;
  }
}
