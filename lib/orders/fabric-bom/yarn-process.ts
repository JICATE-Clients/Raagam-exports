/**
 * "Which yarns does this BOM buy, what treatment does each need, and how much of
 * it must be bought?" — the Fabric BOM ▸ Yarn Process tab (0493 · 0504 · 0529).
 *
 * Client spec 2026-09-01 (second pass); legacy screenshot 2587. Storage and the
 * full reasoning are in `supabase/migrations/0504_fabric_bom_yarn_stages.sql`;
 * this file is the rules, and it is client-safe on purpose (no `server-only`) so
 * the screen shows the same figure the save path stores. The server half is
 * `getBomYarnComposition()` in `./service.ts`.
 *
 * ## FIVE RULES, AND THEY ARE THE WHOLE FILE
 *
 *  1. **The rows are derived** (`deriveYarnRows`). A yarn is on this tab because
 *     a fabric on the BOM is made of it — never because someone added it.
 *  2. **The share** (`yarnShareOf`). A fabric has several yarns, and only its own
 *     blend percentages can say how its weight divides between them. Where they
 *     are not declared and cannot be inferred, this REFUSES rather than guesses.
 *  3. **The combo split** (`yarnNetByCombo`). A yarn is weighed PER COLOURWAY,
 *     because a stage may treat one colour and not another.
 *  4. **The compounded weight** (`yarnPurchase`). Each combo's net grossed by the
 *     SEQUENTIAL product of the stages that apply to it.
 *  5. **A stage may name ONE colourway and gross up only its share** — see
 *     "0529 RESTORES THE COLOURWAY SPLIT" below.
 *
 * ## 0529 RESTORES THE COLOURWAY SPLIT 0520 REMOVED
 *
 * 0504 built `combo` — a stage marked PURPLE grossed up the purple share alone.
 * 0520 (2026-09-03) removed it on the client's own instruction, replacing it
 * with the fixed PROCESS WISE / COLOR WISE label, and its header said plainly:
 * "Restoring the colourway needs a new client decision, not a tidy-up." 0519,
 * seeding COLOR WISE the same day, went further — "nothing branches on
 * 'color_wise' … safe to seed a word whose arithmetic is still being settled
 * with the client."
 *
 * That settlement is this migration: a business requirements document supplied
 * 2026-09-04 asks for exactly the pre-0520 behaviour — a yarn colour dropdown
 * "scoped strictly to the current style's declared colours" that divides a
 * treatment's loss — and was confirmed against this file's own account of what
 * 0520 gave up before being applied. So `combo` is back, unchanged from 0504's
 * shape, and `loss_for_id` stays beside it as the PROCESS WISE / COLOR WISE
 * label the client asked for on 2026-09-03 — now doing what its name always
 * implied: COLOR WISE is what the screen keys the colourway field's VISIBILITY
 * off (`components/orders/yarn-process-grid.tsx`), never the arithmetic. The
 * arithmetic reads `combo` alone, exactly as before 0520, so a lookup renamed on
 * the master degrades the FIELD's visibility and never the purchase figure.
 *
 * ## THE FORMULA REVERSED, 2026-09-11 — THIS IS THE SECOND TIME, AND THIS TIME
 *   IT IS SETTLED BY THE LEGACY SYSTEM'S OWN OUTPUT, NOT A SPEC DOCUMENT
 *
 * **The per-stage form is now `/ (1 - loss/100)`** — `order_fabric_plan_stages`'
 * (0427) backward solve, the SAME formula this file spent from 2026-09-01 to
 * 2026-09-11 explicitly refusing. Two prior attempts to make this exact change
 * were declined (2026-09-01's own client choice, then a 2026-09-04 business
 * requirements document re-raised it and was told "needs a fresh client call
 * naming THIS function, not an inference from a document written without it in
 * view" — see git history on this file for that reasoning in full).
 *
 * What changed: the client supplied the LEGACY RP-SOFTWARE SYSTEM'S OWN PDF
 * EXPORT ("Yarn & fabric requirement.pdf") rather than a redrafted spec, and its
 * numbers were checked arithmetically, not read as an assertion — Knitting's
 * `1536.873 -> 1552.397` at 1% loss is exactly `1536.873 / (1 - 0.01)`,
 * Dyeing's `1460.029 -> 1536.873` at 5% is exactly `1460.029 / (1 - 0.05)`. That
 * is a fresh client call naming this function, over real production numbers,
 * and it is what this reversal rests on — never re-derive the OLD uplift
 * formula from this file's earlier comments without checking whether a newer
 * decision has already overtaken them, which is exactly the mistake this
 * paragraph exists to prevent one direction further on.
 *
 * **Stages still compound sequentially**: 3% then 2% is `/ 0.97 / 0.98`, not a
 * single 5% divisor. Order does not change the product (division composes the
 * same way multiplication did) — unchanged from the uplift form.
 *
 * `scripts/check-yarn-process.mts` now REFUTES the uplift answers it used to
 * pin (1050.00 for two compounding stages, 918/927 for the colourway-split
 * examples) and pins the backward-markup figures instead, several of them
 * taken directly from the legacy PDF's own worked numbers rather than
 * hand-computed — so a "tidy-up" back to `x(1+L)` fails loudly, the same
 * protection the old formula had, now guarding the new one.
 *
 * ## THE STAGE SOURCE MOVED WITH IT: PER-FABRIC ROUTE, NOT PER-YARN TYPING
 *
 * `order_fabric_bom_yarn_stages` (the per-YARN stage grid this tab used to
 * read exclusively) held ZERO rows across the entire live database when this
 * was checked (2026-09-11) — no BOM, ever, had a stage typed on it. Meanwhile
 * `order_fabric_bom_processes` (the Fabric Process tab's per-FABRIC declared
 * route) held 19 real rows, and the legacy PDF's own KNITTING/DYEING/BRUSHING/
 * COMPACTING/STENTERING sections are keyed to the FABRIC ("SOLID 3T FLEECE
 * BRUSHED... / Open Width"), not to a yarn — different fabrics on one BOM
 * plainly run different stage sequences with different losses (fleece alone
 * goes through Brushing).
 *
 * So `yarnPurchase` now applies EACH FABRIC's OWN route BEFORE merging its
 * share into a yarn's combo total, not one flat stage list applied AFTER
 * merging — a yarn shared by two fabrics (32'S BCI COTTON, both a fleece and a
 * single jersey in the legacy example) now correctly grosses up each fabric's
 * contribution by that fabric's own losses before summing. `yarnNetByCombo`
 * (below) is UNCHANGED and still answers a different, still-valid question —
 * the yarn's pure net, no markup — it is simply no longer what `yarnPurchase`
 * builds its total from. The per-yarn stage grid on the Yarn Process screen is
 * UNTOUCHED and still typeable; a stage entered there now COMPOUNDS onto
 * whatever the yarn's fabrics' own routes already contribute (concatenated
 * into one stage list per fabric before the single `comboUplift` call), rather
 * than replacing them — forward-compatible with a real per-yarn treatment
 * (e.g. a yarn dip) that happens in addition to what its cloth goes through.
 *
 * ## AND A FABRIC MAY NOT BE KNITTED HERE AT ALL (0564, 2026-09-16)
 *
 * Everything above assumes the factory buys yarn and knits it — Default Rule
 * No. 1. `doc/order/fabriprocess.md` §2 adds two more sources, declared per
 * FABRIC on `order_fabric_bom_process_scope.source`, and they reach this file
 * in two places and only two:
 *
 *  - `stagesForGroup` DROPS a suppressed step from the ladder — never leaves
 *    it standing at 0% loss, which would divide by 1 and change nothing. It
 *    is the last filter, after the component resolution, and
 *    `./fabric-source.ts` says why that order is load-bearing.
 *  - `yarnPurchase` SKIPS a fabric that is bought as cloth, before it asks
 *    about the blend or the requirement, and says so in its own words when
 *    that leaves a yarn with nothing.
 *
 * `clothPurchase` below is the demand that replaces the yarn — the same
 * arithmetic asked about rolls instead of cones, deliberately written as
 * `yarnPurchase`'s mirror rather than as a new kind of figure.
 *
 * ## IT COMPUTES ONCE AND IS READ TWICE
 *
 * The screen previews it as the planner types and `writeYarns` stores what it
 * returns, exactly as `fabricRequirementRows` is used one section up. Two
 * implementations of one formula is how a preview and a saved figure come to
 * disagree, and here the saved one is what a yarn purchase is raised against.
 *
 * THAT RULE IS WHAT MAKES `sourceByFabric` A REQUIRED ARGUMENT IN SPIRIT
 * THOUGH IT DEFAULTS TO EMPTY. Its default keeps every old call site correct,
 * but a caller that previews a figure the save path will store MUST pass it —
 * otherwise the screen shows Rule 1's yarn and the save stores Rule 2's, and
 * the disagreement is invisible because both numbers look like answers.
 */

import { z } from "zod";
import { ceilToPrecision, uomPrecision } from "@/lib/uom/convert";
import { isRefusal, type Refusal } from "./requirement";
import { ydPartKey } from "./component-map";
import {
  clothPurchaseLabel,
  routeForSource,
  sourceBuysYarn,
  type FabricSource,
} from "./fabric-source";

export { isRefusal };
export type { Refusal };

/**
 * A process as the picker needs it: identity, the disable flag, and the one
 * applicability flag the narrowing reads.
 *
 * `for_yarn` comes down to the browser rather than being filtered in SQL, for
 * the reason AGENTS.md gives under "Disabled rows": a process whose flag is
 * unticked on the master AFTER this BOM named it must stay visible on the row
 * that holds it, or a filled field renders as empty and the next save blanks the
 * FK. Same shape as `FabricProcessOption` in `./processes.ts`.
 */
export type YarnProcessOption = {
  id: string;
  code: string | null;
  name: string;
  inactive: boolean;
  for_yarn: boolean;
};

/**
 * One yarn of one fabric, straight off `material_mixings`.
 *
 * `blend_pct` IS NULLABLE AND THAT IS NOT AN OVERSIGHT IN THE MASTER. The
 * material screen HIDES the % column for a Single Yarn fabric and for a
 * yarn-dyed one (`hidePct` in material-master-screen.tsx), so a null here is the
 * ordinary state for exactly the fabrics this tab serves. What to do about it is
 * `yarnShareOf`'s job, and it is the subtlest rule in the file.
 */
export type YarnComponent = { yarn_id: string; blend_pct: number | null };

/** One fabric's composition — the structured form of the legacy "bracket rule". */
export type FabricComposition = {
  fabric_id: string;
  fabric_name: string;
  components: YarnComponent[];
};

/**
 * One slice of requirement: a fabric, a colourway, and the cloth needed for it.
 *
 * `combo` IS WHY THIS IS NOT ONE ENTRY PER FABRIC. A stage may treat PURPLE and
 * not GREEN, so the yarn has to be weighed per colourway before any loss is
 * applied. A NULL combo means the requirement carries no colour axis, and is
 * kept as its own bucket rather than merged into a named one.
 */
export type FabricGross = {
  fabric_id: string;
  /** YD PART (0596) — which allocation of a yarn-dyed fabric this weight is
   *  for, so it is grossed by THAT part's stripes. Absent/blank = the only part. */
  yd_part?: string | null;
  combo: string | null;
  /** Net cloth required for this slice, in `uom_id`. NULL when the requirement
   *  engine refused it — carried, not dropped, so the yarn row can say WHY it
   *  has no weight rather than silently reading zero. */
  gross: number | null;
  uom_id: string | null;
  /**
   * WHY `gross` IS NULL, in the requirement engine's own words.
   *
   * The type comment above has promised since 0493 that this row "can say WHY",
   * and until 2026-09-03 nothing carried the sentence: `yarnNetByCombo` printed
   * one generic line and ended it "see Calculated Quantities" — a SECTION THIS
   * SCREEN REMOVED ON 2026-09-01. So the tab named a fix the operator could not
   * find, went looking, failed, and read the screen as broken rather than the
   * sentence (client screenshot 2660; AGENTS.md says this of menu paths and
   * `fabric-bom-screen.tsx` had already fixed the one OTHER sentence naming that
   * section, at the foot of Fabric Process — this was the remainder).
   *
   * BOTH SIDES ALREADY HELD IT. `PreviewRow.refusal` on the screen and
   * `order_fabric_bom_requirements.refusal_reason` on the server are the same
   * sentence — "Enter the consumption for WHITE · S" — and each was being thrown
   * away one line before it reached here.
   *
   * OPTIONAL, so a caller that has no reason is still well-formed: the fallback
   * in `yarnNetByCombo` is what a null means, not an empty string.
   */
  refusal?: string | null;
  /**
   * WHICH PANELS THIS WEIGHT COVERS — the Manual entry's own `component_ids`
   * (0494), carried so a "Component Wise" route (0528) can be resolved to the
   * one sequence that grosses this slice. See `stagesForGroup` for the rule.
   * Optional and empty by default: a caller without it gets the unscoped
   * steps only, never every component's steps stacked.
   */
  component_ids?: readonly string[];
  /**
   * IS THIS SLICE PRINTED? (2026-09-19.) `printedGroup` over the BOM's lines
   * for this (fabric, colourway, components) — see `routeForPrint` for what a
   * `false` removes. Optional, and absent means "don't know", which walks the
   * route whole: a caller that has not been taught about prints gets the
   * arithmetic it always got.
   */
  printed?: boolean;
};

/** The bucket key for a colourway. One function so the screen, the engine and
 *  the save path cannot spell "no colourway" three different ways. */
export const comboKey = (combo: string | null | undefined): string =>
  (combo ?? "").trim().toUpperCase();

/**
 * One process a yarn runs, in client state — the child grid's row.
 *
 * `loss_for_id` IS THE `For` COLUMN'S LABEL — `config_lookups` id of kind
 * `process_loss_for`, the SAME list the fabric route's `Loss for` reads: PROCESS
 * WISE or COLOR WISE. `combo` IS THE ARITHMETIC (0529, restoring 0504's shape
 * after 0520 removed it): which colour lot the step treats, and blank means
 * every one. The two are related only through the SCREEN — COLOR WISE is what
 * reveals the `combo` field — never through the engine, which reads `combo`
 * alone regardless of what `loss_for_id` says. See the file header, "0529
 * RESTORES THE COLOURWAY SPLIT".
 */
export type YarnStageRow = {
  key: string;
  stage_id: string | null;
  process_id: string | null;
  loss_for_id: string | null;
  /** The `For` column's ARITHMETIC — which colourway this step's Loss % applies
   *  to. `""` means every colourway, the ordinary case; stored as NULL. See
   *  `stageCoversCombo`. */
  combo: string;
  description: string;
  /** Text, like every numeric cell on this screen: a controlled `<Input>` cannot
   *  hold "1." or "" as a number, so the form keeps text and the boundary
   *  converts once. */
  loss_pct: string;
};

/**
 * One row of the tab: a yarn, and the treatments under it.
 *
 * `key` IS THE YARN ID, not a minted React key, and that is what makes the tab
 * derivable without losing what the planner typed. Every other grid in this
 * module mints keys because its rows are created by hand; here a row IS a yarn,
 * so the yarn's id is a stable identity across a re-derivation — the fabric
 * lines can change under the operator and the stages stay attached to the right
 * yarns.
 */
export type YarnRow = {
  key: string;
  item_id: string;
  name: string;
  inactive: boolean;
  /** Which fabrics declare it — the muted line under the name. One yarn is
   *  legitimately in several, and a list of bare counts is unreadable without
   *  it. */
  fabrics: string[];
  stages: YarnStageRow[];
};

/** What a saved BOM holds per yarn — what a re-derived row is re-attached to. */
export type YarnAnswer = { stages: YarnStageRow[] };

export const blankYarnStage = (key: string): YarnStageRow => ({
  key,
  stage_id: null,
  process_id: null,
  loss_for_id: null,
  combo: "",
  description: "",
  loss_pct: "",
});

/**
 * The yarn rows a BOM's fabrics imply, in a stable order.
 *
 * DE-DUPLICATED BY YARN. One yarn in three fabrics is ONE purchase line and one
 * decision about how it is treated; three rows would be three answers to one
 * question and a triple-counted weight the moment they disagreed.
 *
 * STAGES ARE RE-ATTACHED BY `item_id`, so editing the fabric lines never
 * disturbs a treatment the planner has already recorded for a yarn that is still
 * there. A yarn that has left every composition simply produces no row, and its
 * stored stages go with it on the next save — the intended reading of removing
 * the fabric, and the call `normalizeProcesses` (0492) makes for a route whose
 * line has gone.
 *
 * SORTED BY NAME rather than by first appearance: the fabric lines are reordered
 * freely, and a purchase list that shuffled itself every time would be
 * unreadable against yesterday's copy.
 */
/**
 * THE COMPOSITIONS WHOSE YARN IS ACTUALLY BOUGHT (client 2026-09-19, Rule 2).
 *
 * A cloth bought as greige or dyed rolls buys no yarn — so its yarns must not
 * appear on the Yarn Process tab or be stored as a yarn row at all. Until now
 * `deriveYarnRows` listed them anyway and the save stored a row with a null
 * purchase and the refusal "every fabric using this yarn is bought as cloth";
 * that empty row hid the report's Total Yarn Purchase Requirement and made the
 * Budget warn about "skipped" figures nothing owed. The screen and the save
 * both filter through this one function, so the tab and the stored rows agree.
 */
export function compositionsBuyingYarn<C extends { fabric_id: string }>(
  compositions: readonly C[],
  sourceOf: (fabricId: string) => FabricSource,
): C[] {
  return compositions.filter((c) => sourceBuysYarn(sourceOf(c.fabric_id)));
}

export function deriveYarnRows(
  compositions: readonly FabricComposition[],
  yarnNames: ReadonlyMap<string, { name: string; inactive: boolean }>,
  answers: ReadonlyMap<string, YarnAnswer>,
): YarnRow[] {
  const fabricsByYarn = new Map<string, Set<string>>();

  for (const f of compositions) {
    for (const c of f.components) {
      if (!c.yarn_id) continue;
      const seen = fabricsByYarn.get(c.yarn_id) ?? new Set<string>();
      /* A `Set` because one fabric may list the same yarn on two mixing lines (a
         blend re-stated), and "COTTON JERSEY · COTTON JERSEY" reads as a bug
         rather than as a repetition. */
      if (f.fabric_name) seen.add(f.fabric_name);
      fabricsByYarn.set(c.yarn_id, seen);
    }
  }

  return [...fabricsByYarn]
    .map(([yarnId, fabrics]) => {
      const known = yarnNames.get(yarnId);
      return {
        key: yarnId,
        item_id: yarnId,
        /* A YARN THE ITEM QUERY DID NOT RETURN STILL GETS A ROW. It is on the
           fabric's composition, so it is bought; showing nothing would drop a
           purchase line for a data problem the planner cannot see. The name says
           what happened instead. */
        name: known?.name ?? "(unnamed yarn)",
        inactive: known?.inactive ?? false,
        fabrics: [...fabrics].sort(),
        stages: answers.get(yarnId)?.stages ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What fraction of ONE fabric's weight is this yarn?
 *
 * THREE CASES AND THE THIRD IS THE ONE THAT MATTERS:
 *
 *  - **A declared percentage** — use it. 95% cotton is 95% of the cloth.
 *  - **One component, no percentage** — it is the whole fabric. That is not a
 *    guess: the master hides the % column precisely because a Single Yarn fabric
 *    is 100% of one yarn, and the live data shows exactly this shape
 *    (`SOLID PIQUE (10'S COMBED COTTON) 100%`, one mixing row, no pct).
 *  - **Several components, no percentages** — REFUSE. A yarn-dyed stripe of two
 *    counts might be 50/50 or 90/10 and nothing in this database knows which.
 *    Splitting equally would invent a purchase quantity, and a figure a buyer
 *    acts on is the last place to invent one. The message names the master to go
 *    and fix, because "empty and explain, never a silent fallback" (AGENTS.md).
 *
 * A MIXED FABRIC — some rows with percentages, some without — refuses too. It is
 * the same problem: the un-percentaged remainder could be any split of what is
 * left.
 */
export function yarnShareOf(
  fabric: FabricComposition,
  yarnId: string,
): number | Refusal {
  const mine = fabric.components.filter((c) => c.yarn_id === yarnId);
  if (mine.length === 0) return 0;

  /* SUMMED, NOT "the first one". A fabric may state a yarn twice — 60% warp and
     40% weft of one count — and taking one row would buy 60% of what is needed
     with nothing on screen to say so. */
  const declared = mine.reduce((sum, c) => sum + (c.blend_pct ?? 0), 0);
  if (mine.every((c) => c.blend_pct != null)) return declared / 100;

  if (fabric.components.length === mine.length) {
    // Every component of this fabric IS this yarn, and none carries a
    // percentage: the Single Yarn case. The whole cloth.
    return 1;
  }

  return {
    refused:
      `${fabric.fabric_name || "This fabric"} names ${fabric.components.length} yarns ` +
      "with no blend percentages, so its weight cannot be split between them — " +
      "enter the Mixing % on the material master",
  };
}

/**
 * The NET yarn needed, per colourway, before any process loss.
 *
 * THE COMBO AXIS IS THE POINT. The client's rule for the `For` column is that a
 * treatment "only applies … to the exact weight percentage of yarn destined for
 * that specific colour combo", so the weight has to be divided BEFORE any loss
 * is applied. Summing to one figure first and grossing that up would charge a
 * purple-only dyeing loss to the green yarn as well.
 *
 * `uom_id` IS RETURNED BESIDE THE MAP because it has to be checked while the
 * slices are being walked: two fabrics measured in kg and in metres cannot be
 * added into one purchase weight, and nothing downstream would notice — the
 * budget would price a number with no unit behind it.
 */
export function yarnNetByCombo(
  yarnId: string,
  fabrics: readonly FabricGross[],
  compositions: ReadonlyMap<string, FabricComposition>,
): { net: Map<string, number>; uom_id: string | null } | Refusal {
  const net = new Map<string, number>();
  let uomId: string | null = null;
  let used = 0;

  for (const f of fabrics) {
    const comp = compositions.get(f.fabric_id);
    if (!comp) continue;

    const share = yarnShareOf(comp, yarnId);
    if (isRefusal(share)) return share;
    if (share === 0) continue;

    if (f.gross == null) {
      const fabric = comp.fabric_name || "One fabric";
      /* THE ENGINE'S OWN SENTENCE WINS. It names the size, the colourway or the
         master to go and fix; the generic line below names none of them and is
         only reachable when a caller carried no reason at all. Prefixed with the
         fabric because this row is a YARN — several cloths feed it, and a bare
         "Enter the consumption for WHITE · S" would not say which. */
      return {
        refused: f.refusal
          ? `${fabric}: ${f.refusal}`
          : `${fabric} has no calculated requirement yet, so its yarn cannot be ` +
            "worked out — answer its weight on Manual",
      };
    }

    if (f.uom_id && uomId && f.uom_id !== uomId) {
      return {
        refused:
          "The fabrics using this yarn are measured in different units, so their " +
          "requirements cannot be added — give them one unit on Fabric Allocation",
      };
    }
    if (f.uom_id) uomId = f.uom_id;

    const key = comboKey(f.combo);
    net.set(key, (net.get(key) ?? 0) + f.gross * share);
    used++;
  }

  if (used === 0) return { refused: "No fabric on this BOM uses this yarn" };
  return { net, uom_id: uomId };
}

/**
 * Does this stage treat this colourway? (0504, restored 0529.)
 *
 * A BLANK `stageCombo` MEANS EVERY COLOURWAY — the ordinary case, and the only
 * thing a blank box can mean here. Reading it as "no colourway" would make a
 * stage the planner filled in apply to nothing, and the arithmetic would
 * silently ignore a loss they deliberately entered.
 */
export const stageCoversCombo = (stageCombo: string | null, combo: string): boolean =>
  comboKey(stageCombo) === "" || comboKey(stageCombo) === combo;

/** One declared step of a fabric's route, as every reader of
 *  `order_fabric_bom_processes` (and the yarn's own stage grid, which has no
 *  `component_id`) hands it to the engine. */
export type RouteStage = {
  combo: string | null;
  /** WHICH PANEL this step is scoped to, when the fabric's route is split
   *  "Component Wise" (0528). Optional so the yarn's own stages and every
   *  pre-0528 caller are still well-formed; absent or null means the step
   *  applies to every component. */
  component_id?: string | null;
  loss_pct: number | null;
  stage_id?: string | null;
  process_id?: string | null;
  /* WHAT KIND OF STEP THIS IS (0564), straight off the process master's own
     `is_knitting` / `is_dyeing` flags — carried ON THE STEP, exactly the way
     `component_id` came to be carried on it (2026-09-15), rather than passed
     beside the route as a second lookup every caller would have to assemble.
     A route is built in four places (the screen's `routesByFabric`,
     `routesByFabricOf` in actions.ts, and both reports); a fact the engine
     needs and the step does not carry is a fact three of those four forget.

     BOTH OPTIONAL AND BOTH MEANING "not that kind" WHEN ABSENT, so every
     pre-0564 caller composes a route that suppresses nothing. See
     `./fabric-source.ts` for what an absent flag costs and why it costs it in
     the safe direction. */
  is_knitting?: boolean | null;
  is_dyeing?: boolean | null;
  /** Which of the process's sub-categories (0583) — a LABEL only; the
   *  arithmetic never reads it. */
  sub_category_id?: string | null;
  /** Is this step a PRINT process (`processes.is_print`)? Carried for the same
   *  reason as the two above — see `routeForPrint`. Absent = not a print. */
  is_print?: boolean | null;
};

/**
 * THE PRINT STAGE LEAVES THE LADDER OF A GROUP THAT IS NOT PRINTED (client
 * 2026-09-19: "the system must isolate that specific color's weight").
 *
 * A route is declared once per fabric, but a print is declared per colourway
 * and component on the order. So on a fabric where NAVY is AOP and WHITE is
 * plain, one route carries `… → DYEING → PRINTING → DIP-WASH → COMPACTING`,
 * and until now WHITE's weight was grossed by the printing loss and the
 * post-print finishing too — a silent over-buy on every unprinted colourway,
 * and a printing figure that counted cloth nobody sends to the printer.
 *
 * WHAT LEAVES IS THE WHOLE STAGE THE PRINT STEP SITS IN, not just the print
 * step: DIP-WASH, GUM CUTTING and the second COMPACTING are post-print
 * finishing (0570's Printed stage) and only happen to printed cloth. The stage
 * is found FROM THE ROUTE — whichever stage holds an `is_print` step — so no
 * stage lookup is needed and the order of `stages` does not matter (a report
 * walking the route backwards gets the same answer).
 *
 * `printed` UNDEFINED CHANGES NOTHING, and that is every caller that has not
 * been taught about prints (IWO Fabric BOM, the vectors): the route is walked
 * whole, as it always was. Only an explicit `false` isolates.
 *
 * Same shape as `routeForSource`: steps are REMOVED, never zeroed — a 0% step
 * multiplies by exactly 1 and would change nothing (`./fabric-source.ts`).
 */
export function routeForPrint<S extends RouteStage>(stages: readonly S[], printed: boolean | undefined): S[] {
  if (printed !== false) return [...stages];
  const printStages = new Set(
    stages.filter((s) => s.is_print && s.stage_id).map((s) => s.stage_id as string),
  );
  return stages.filter((s) => !s.is_print && !(s.stage_id && printStages.has(s.stage_id)));
}

/**
 * THE STEPS THAT TREAT ONE (COLOURWAY, COMPONENT-SET) — the single filter every
 * ladder is built through, and the place the "Component Wise" toggle (0528)
 * reaches the arithmetic at all.
 *
 * ## THE COLOUR AXIS IS `stageCoversCombo`, UNCHANGED
 *
 * A blank `combo` on a step means every colourway; a named one means that
 * colourway alone. Nothing about that changed here.
 *
 * ## THE COMPONENT AXIS NEEDS A RESOLUTION, NOT JUST A FILTER
 *
 * A component-wise route is declared PER PANEL (FRONT BODY runs KNITTING →
 * DYEING → STENTER → COMPACTING, NECK RIB runs KNITTING → DYEING →
 * COMPACTING), but the requirement it is applied to is weighed per MANUAL
 * ENTRY — "one fabric structure plus one SET of components" (0494, "the entry
 * is the counting unit"). So the question "which route grosses this weight?"
 * has three honest answers and one dishonest one:
 *
 * - the entry names ONE component that has a route → that component's steps,
 *   plus any unscoped step (a step with no `component_id` treats every panel);
 * - the entry names SEVERAL, and they all declare the IDENTICAL sequence →
 *   that sequence, once. "One distinct answer or nothing", the same rule
 *   `resolveGsm` / `soleStyleRefNo` already apply in `reports.ts`;
 * - the entry names components with DIFFERENT routes → REFUSE, naming the fix
 *   (count them in separate entries). The entry's weight is one figure with no
 *   per-component split inside it, so neither route can be applied to "its
 *   share" — there is no share;
 * - the entry names no component that has a route → only the unscoped steps
 *   apply. A component-wise fabric whose route has not been typed for this
 *   panel yet is "no route declared", the same zero-loss reading a fabric with
 *   no route at all has always had.
 *
 * THE DISHONEST ANSWER IS WHAT EVERY READER DID UNTIL 2026-09-15: nothing that
 * read the route carried `component_id`, so every component's steps were seen
 * as ONE route and STACKED — Body's four stages and Rib's three compounded as
 * seven on every kilo of that fabric. A silent over-purchase, indistinguishable
 * on screen from a correct figure. `scripts/check-fabric-bom-reports.mts`
 * refutes it by name.
 *
 * `componentIds` DEFAULTS TO NONE, and the default is deliberately the
 * UNDER-count (unscoped steps only), never the stack: a caller that does not
 * know its component cannot be handed a component's loss, but it must never be
 * handed all of them.
 *
 * ORDER IS PRESERVED from the input — this filters, it never re-sorts — so a
 * caller that reversed the route for the backward walk (see `reports.ts`)
 * gets its reversed order back.
 */
export function stagesForGroup<S extends RouteStage>(
  stages: readonly S[],
  combo: string,
  componentIds: readonly string[] = [],
  /** WHERE THE CLOTH COMES FROM (0564) — see `./fabric-source.ts`. Defaults
   *  to Rule 1, so every pre-0564 call site walks the route whole, exactly as
   *  it always has. */
  source: FabricSource = "yarn_knit",
  /** IS THIS GROUP PRINTED? (2026-09-19) — see `routeForPrint`. Undefined
   *  walks the route whole, which is every pre-existing caller. */
  printed?: boolean,
): S[] | Refusal {
  const forColour = stages.filter((s) => stageCoversCombo(s.combo, combo));
  const named = resolveRouteComponents(forColour, componentIds);
  if (isRefusal(named)) return named;
  const resolved =
    named.length === 0
      ? forColour.filter((s) => !s.component_id)
      : /* `named[0]` stands for all of them — `resolveRouteComponents` has just
           proved every name in the list declares the identical sequence. */
        forColour.filter((s) => !s.component_id || s.component_id === named[0]);
  /* THE SOURCE FILTER RUNS LAST, AFTER THE COMPONENT RESOLUTION, AND THE
     ORDER IS LOAD-BEARING. `resolveRouteComponents` refuses when two panels
     declare DIFFERENT sequences, comparing `(stage, process, loss)` — and
     Body-with-knitting and Rib-without still genuinely differ whatever the
     cloth is bought as. Suppressing first would make two routes that the
     operator must reconcile look identical, and the entry would be grossed by
     a sequence neither panel declares. What a source changes is which
     declared steps COST something, never what was declared. The print filter
     runs last for the same reason. */
  return routeForPrint(routeForSource(resolved, source), printed);
}

/**
 * WHICH OF AN ENTRY'S PANELS THE ROUTE IS RESOLVED TO — the resolution half of
 * `stagesForGroup`, exported so a report can LABEL the branch a weight was
 * grossed by ("FRONT BODY, BACK BODY") and key its totals on it.
 *
 * Returns the entry's components that carry a component-scoped step, PROVIDED
 * they all declare the identical (stage, process, loss) sequence; `[]` when
 * none of them does (only unscoped steps apply); a refusal when two of them
 * disagree. `stages` is expected already colour-filtered; a caller passing
 * the whole route gets the same answer for a route with no colour split.
 */
export function resolveRouteComponents(
  stages: readonly RouteStage[],
  componentIds: readonly string[],
): string[] | Refusal {
  const scoped = stages.filter((s) => !!s.component_id);
  if (scoped.length === 0) return [];

  const named = [...new Set(componentIds)].filter((id) => scoped.some((s) => s.component_id === id));
  if (named.length <= 1) return named;

  /* IDENTICAL means the same (stage, process, loss) sequence in the same
     order — the whole of what a route says. `loss_pct` null and 0 are the
     same step to the arithmetic and are compared as such. */
  const signature = (id: string) =>
    JSON.stringify(
      scoped
        .filter((s) => s.component_id === id)
        .map((s) => [s.stage_id ?? null, s.process_id ?? null, s.loss_pct ?? 0]),
    );
  const first = signature(named[0]);
  if (named.some((id) => signature(id) !== first)) {
    return {
      refused:
        "its components run different process routes on Fabric Process, so one " +
        "weight cannot be grossed by both — count them in separate entries on Manual",
    };
  }
  return named;
}

/**
 * One colourway's gross-up factor: the SEQUENTIAL backward-markup product of
 * the stages treating it.
 *
 * `/ 0.97 / 0.98`, NOT `/ 0.95`. Each stage's loss is a fraction of that
 * stage's OWN OUTPUT (the physical reading — a knitting machine that loses 1%
 * loses 1% of what it produces, not 1% of the yarn fed in), so solving for the
 * required INPUT divides by `(1 - loss/100)` rather than multiplying by
 * `(1 + loss/100)`. This is `order_fabric_plan_stages`' (0427) formula,
 * reversed onto this file 2026-09-11 after two declined attempts — see the
 * file header for the full history and why THIS attempt is the one that
 * stuck (the legacy system's own PDF export, checked arithmetically).
 *
 * ORDER DOES NOT CHANGE THE PRODUCT: division by a sequence of factors
 * commutes the same way multiplication did. `sno` orders what the planner
 * READS, not what the arithmetic does.
 */
export function comboUplift(
  stages: readonly RouteStage[],
  combo: string,
  /** The components the weight being grossed belongs to — see
   *  `stagesForGroup` for what the engine does with them, and why an empty
   *  list means "unscoped steps only", never "every component's steps". */
  componentIds: readonly string[] = [],
  /** WHERE THE CLOTH COMES FROM (0564). Same fourth argument as
   *  `comboUpliftBreakdown` below and for the same reason the third one is
   *  shared: the two must walk the IDENTICAL stage list. */
  source: FabricSource = "yarn_knit",
  /** Same fifth argument as `stagesForGroup` (2026-09-19). */
  printed?: boolean,
): number | Refusal {
  const treating = stagesForGroup(stages, combo, componentIds, source, printed);
  if (isRefusal(treating)) return treating;
  let factor = 1;
  for (const s of treating) {
    const loss = s.loss_pct ?? 0;
    if (loss < 0 || loss >= 100) {
      return { refused: "Process loss must be 0 or more and below 100" };
    }
    factor *= 1 / (1 - loss / 100);
  }
  return factor;
}

/**
 * `comboUplift`'s own ladder, ADDITIVE and read-only — for the Yarn &
 * Fabric Requirement Report's stage-by-stage breakdown (Planned Wt entering a
 * stage, To Ordered Wt leaving it, e.g. KNITTING then DYEING then COMPACTING).
 *
 * `comboUplift` only ever returns the FINAL product, by design — the file
 * header's "IT COMPUTES ONCE AND IS READ TWICE" is about the preview and the
 * stored `purchase_qty` staying one computation, and a caller that wants the
 * ladder underneath that number has had nowhere to read it. This walks the
 * IDENTICAL loop, in the IDENTICAL order, over the IDENTICAL inputs, and
 * records each stage's factor before and after instead of discarding it. It
 * changes NOTHING about what `comboUplift`/`yarnPurchase` compute, store, or
 * refuse on — same filter (`stageCoversCombo`), same loss validation, same
 * refusal message, same arithmetic.
 *
 * `check-fabric-bom-reports.mts` proves the two can never disagree: for every
 * input, this function's final `factor` equals `comboUplift`'s return
 * (success mirrors success, refusal mirrors refusal with the same message),
 * and the ladder chains — `steps[i].factorAfter === steps[i+1].factorBefore`
 * for every adjacent pair, `steps[0].factorBefore === 1`, and the last step's
 * `factorAfter === factor`. Demonstrated failing first against a mutation
 * that drops a stage from the ladder while leaving `factor` alone.
 */
export type StageUpliftStep = {
  stage_id: string | null;
  process_id: string | null;
  loss_pct: number;
  /** 0583 — present only when the step names a sub-category, so a ladder with
   *  none keeps its exact pre-0583 shape. */
  sub_category_id?: string | null;
  /** The running factor BEFORE this stage is applied (1 for the first stage
   *  that treats this colourway). */
  factorBefore: number;
  /** The running factor AFTER — `factorBefore / (1 - loss_pct/100)`. */
  factorAfter: number;
};

export function comboUpliftBreakdown(
  stages: readonly RouteStage[],
  combo: string,
  /** Same third argument as `comboUplift`, for the same reason — the two
   *  must walk the IDENTICAL stage list or the ledger a report prints stops
   *  matching the total a purchase was raised against. */
  componentIds: readonly string[] = [],
  /** Same fourth argument as `comboUplift`, for the same reason (0564). A
   *  ledger that printed a KNITTING row for a fabric the engine did not
   *  charge knitting on would be the report and the purchase disagreeing in
   *  the one place a reader would not think to check. */
  source: FabricSource = "yarn_knit",
  /** Same fifth argument as `comboUplift`, for the identical-list reason. */
  printed?: boolean,
): { factor: number; steps: StageUpliftStep[] } | Refusal {
  const treating = stagesForGroup(stages, combo, componentIds, source, printed);
  if (isRefusal(treating)) return treating;
  let factor = 1;
  const steps: StageUpliftStep[] = [];
  for (const s of treating) {
    const loss = s.loss_pct ?? 0;
    if (loss < 0 || loss >= 100) {
      return { refused: "Process loss must be 0 or more and below 100" };
    }
    const factorBefore = factor;
    factor *= 1 / (1 - loss / 100);
    steps.push({
      stage_id: s.stage_id ?? null,
      process_id: s.process_id ?? null,
      ...(s.sub_category_id ? { sub_category_id: s.sub_category_id } : {}),
      loss_pct: loss,
      factorBefore,
      factorAfter: factor,
    });
  }
  return { factor, steps };
}

/** One colourway's line of the answer. `net` is the SUM of pre-markup net
 *  across every fabric feeding this combo — informational (Report 1's "Net
 *  Req Wt" column), never itself grossed, since each fabric that fed it may
 *  have been marked up by a different factor before this sum was taken. */
export type YarnComboWeight = { combo: string; net: number; gross: number };

/** One fabric's own contribution to a yarn — the row `byFabric` carries so a
 *  report can show WHICH cloth's route produced which share, and so the
 *  per-fabric markup (route can differ per fabric) is never lost by summing
 *  too early. */
export type YarnFabricWeight = {
  fabric_id: string;
  combo: string;
  net: number;
  gross: number;
  factor: number;
};

/**
 * The yarn to buy, and the breakdown that produced it.
 *
 * Each colourway's net is grossed by the stages TREATING IT (0529), ROUNDED UP
 * to the unit's own precision, and summed. Rounding per colourway rather than
 * once at the end is deliberate: a purchase per colour is a real lot, and
 * rounding a total DOWN buys less yarn than the order needs.
 *
 * REFUSALS PROPAGATE AND ARE NOT SWALLOWED. A yarn whose share cannot be worked
 * out for one of its fabrics has no total worth printing: two thirds of an answer
 * that looks like a whole one is exactly the shape a buyer would act on.
 *
 * EACH FABRIC APPLIES ITS OWN ROUTE BEFORE THE MERGE (2026-09-11). A yarn
 * shared by two fabrics with different process sequences and losses — the
 * legacy example's 32'S BCI COTTON, used in both a fleece (through Brushing)
 * and a plain single jersey (skipping it) — cannot be correct if the two
 * fabrics' nets are summed FIRST and one stage list applied to the total: that
 * would charge one fabric's losses onto the other's cloth. So the loop below
 * grosses each (fabric, combo) contribution with THAT FABRIC's OWN declared
 * route (`routesByFabric.get(f.fabric_id)`) — from `order_fabric_bom_processes`,
 * the Fabric Process tab, the only place this data is actually declared today
 * (see the file header) — CONCATENATED with `yarnOwnStages` (whatever is still
 * typed on this yarn's OWN Yarn Process row, forward-compatible with a real
 * per-yarn treatment on top of what its cloth already goes through), and only
 * THEN merges into the yarn's per-combo total. `yarnNetByCombo` above answers
 * a genuinely different, still-valid question — the yarn's pure net, no
 * markup at all — and is kept for whatever wants that; this function no
 * longer builds its own total from it.
 */
/**
 * One DYED SHADE of one yarn, within one cloth and one colourway (0568).
 *
 * `share` is that shade's fraction OF THE YARN — `MixingDetailRow`'s
 * `calculated_pct / 100`, which sums to 1 across a yarn's dyed stripes — and
 * NOT its share of the cloth (`mixing_pct`). The yarn's own weight is what is
 * being divided here; the cloth was already divided by the blend, one step
 * earlier.
 *
 * `loss_pct` is the dye house's loss for that shade, off
 * `order_fabric_bom_yd_combination_colors.dyeing_loss_pct` (0568) — a property
 * of the dyestuff, which is why it travels with the colour and not with the
 * feeder slot that happened to knit it.
 */
export type YarnShade = {
  fabric_id: string;
  /** YD PART (0596) — which allocation of the fabric declared this shade.
   *  Absent/blank = the fabric's only part. See `ydPartKey`. */
  yd_part?: string | null;
  yarn_id: string;
  /** The assort colourway whose combination declared this shade. */
  combo: string | null;
  /** 0..1 of the YARN. */
  share: number;
  loss_pct: number;
};

/**
 * WHAT ONE YARN'S DYED WEIGHT MUST BE GROSSED BY to become grey yarn to buy.
 *
 *     Σ over the yarn's shades:  share_s / (1 - loss_s/100)
 *
 * ## IT IS A WEIGHTED SUM, NOT ONE DIVISION
 *
 * Each shade is dyed in its own lot and loses its own percentage, so the yarn's
 * grey requirement is the sum of its shades' grey requirements — it cannot be
 * expressed as a single loss applied to the whole. The legacy printout's own
 * numbers are the proof: 1021.000 kg splitting 50 / 33.33 / 16.67 at 5% / 4% /
 * 3% buys 1067.311 kg, where a single averaged loss would buy 1066.9-something.
 *
 * ## A YARN WITH NO SHADES DECLARED GROSSES BY NOTHING
 *
 * Returns 1, which is what this engine did before 0568 and what an all-solid
 * order will always want. The same reading a `dyeing_loss_pct` of 0 gets: a
 * loss nobody declared is not a loss to invent.
 *
 * ## THE SHARES ARE NOT RE-NORMALISED, AND A GAP IS REFUSED
 *
 * Shares that do not sum to 1 mean the caller's mixing panel is half-answered.
 * Scaling them to fit would silently redistribute a missing stripe's weight
 * across the others — inventing a split nobody typed, which is the failure
 * `yarnShareOf` refuses for the blend one level up. Tolerance is a thousandth,
 * which is past any rounding `calculated_pct` can produce.
 */
export function shadeDyeFactor(
  shades: readonly YarnShade[],
  fabricId: string,
  yarnId: string,
  combo: string,
  /** YD PART (0596): a Top knitted 80/20 and a Bottom knitted 70/30 from one
   *  cloth are two sets of shades; each weight is grossed by its own part's.
   *  Omitted = the only part, which is every document before 0596. */
  ydPart: string | null = null,
): number | Refusal {
  const part = ydPartKey(ydPart);
  const mine = shades.filter(
    (h) =>
      h.fabric_id === fabricId &&
      h.yarn_id === yarnId &&
      comboKey(h.combo) === combo &&
      ydPartKey(h.yd_part) === part,
  );
  if (mine.length === 0) return 1;

  const total = mine.reduce((sum, h) => sum + h.share, 0);
  if (Math.abs(total - 1) > 0.001) {
    return {
      refused:
        "This fabric's yarn-dyed stripes do not account for the whole yarn, so its dyeing loss cannot be worked out — check the Mixing Details on Yarn Dyed Details",
    };
  }

  let factor = 0;
  for (const h of mine) {
    if (!Number.isFinite(h.loss_pct) || h.loss_pct < 0 || h.loss_pct >= 100) {
      return {
        refused: `A dyeing loss of ${h.loss_pct}% is out of range — enter a percentage under 100`,
      };
    }
    factor += h.share / (1 - h.loss_pct / 100);
  }
  return factor;
}

export function yarnPurchase(
  yarnId: string,
  fabrics: readonly FabricGross[],
  compositions: ReadonlyMap<string, FabricComposition>,
  routesByFabric: ReadonlyMap<string, readonly RouteStage[]>,
  /** The yarn's OWN typed steps (Yarn Process tab). `dyed` marks a step in a
   *  coloured stage — the hand-typed YARN DYEING — see "ONE DYEING LOSS" below. */
  yarnOwnStages: readonly { combo: string | null; loss_pct: number | null; dyed?: boolean }[],
  decimals: number | null,
  /** EACH FABRIC'S OWN SOURCE (0564) — see `./fabric-source.ts`. A fabric
   *  bought as cloth buys no yarn, so it leaves this sum entirely. Defaults
   *  to empty, which reads Rule 1 for every fabric: a caller that has not
   *  been taught about sources gets the arithmetic it always got. */
  sourceByFabric: ReadonlyMap<string, FabricSource> = new Map(),
  /**
   * THE DYED SHADES OF THIS YARN (0568) — see `shadeDyeFactor`.
   *
   * DEFAULTS TO EMPTY, WHICH GROSSES BY NOTHING, and that default is a real
   * hazard rather than a convenience: omitting it on a document that DOES have
   * shades under-buys the yarn by every shade's dye loss, silently. It is kept
   * for the reason `sourceByFabric` one parameter above keeps its own — making
   * it required costs 55 call sites in `check-yarn-process.mts` an argument
   * that says nothing (`[]` on every solid-fabric vector), and burying the
   * intent of 55 assertions to guard 2 callers is the worse trade.
   *
   * SO THE TWO CALLERS ARE ENUMERATED INSTEAD, and both pass it today:
   *
   *   `yarnShadesOf`  (./actions.ts)              — the SAVE, per document
   *   `yarnShades`    (fabric-bom-screen.tsx)     — the PREVIEW, per render
   *
   * A THIRD CALLER MUST PASS IT TOO. Those two are the same figure computed
   * once and read twice (this file's own header), so a new reader that skips
   * this argument does not merely get old arithmetic — it disagrees with the
   * stored purchase weight on every yarn-dyed order. `yarnShadesFrom`
   * (./yarn-dyed.ts) is the one-line way to build it; never assemble the
   * repeats/combinations join a second time.
   */
  shades: readonly YarnShade[] = [],
): { qty: number; uom_id: string | null; byCombo: YarnComboWeight[]; byFabric: YarnFabricWeight[] } | Refusal {
  const dp = uomPrecision(decimals);
  let uomId: string | null = null;
  let used = 0;
  /* HOW MANY OF THIS YARN'S CLOTHS ARE BOUGHT READY-MADE — counted, not just
     skipped, so the refusal below can tell "no fabric uses this yarn" apart
     from "every cloth that uses it is bought as cloth". They are opposite
     situations: the first is a stale row, the second is the operator's own
     answer working correctly, and a buyer reading the first sentence under
     the second would go looking for a data problem that is not there. */
  let boughtAsCloth = 0;
  const byFabric: YarnFabricWeight[] = [];
  const comboNet = new Map<string, number>();
  const comboGross = new Map<string, number>();

  for (const f of fabrics) {
    const comp = compositions.get(f.fabric_id);
    if (!comp) continue;

    /* RULE 2 LEAVES THE YARN SUM ALTOGETHER (§2: "disables and suppresses
       Yarn Purchase"), and it is tested BEFORE the share and before the
       `gross == null` guard on purpose. A greige roll bought from the market
       has no yarn to buy whether or not its blend is declared and whether or
       not its own requirement could be worked out — refusing here on a
       composition problem would be refusing a figure nobody is asking for,
       and would block every OTHER fabric's contribution to the same yarn. */
    if (!sourceBuysYarn(sourceByFabric.get(f.fabric_id) ?? "yarn_knit")) {
      boughtAsCloth++;
      continue;
    }

    const share = yarnShareOf(comp, yarnId);
    if (isRefusal(share)) return share;
    if (share === 0) continue;

    if (f.gross == null) {
      const fabric = comp.fabric_name || "One fabric";
      /* THE ENGINE'S OWN SENTENCE WINS — see `yarnNetByCombo`'s identical
         guard, which this loop otherwise mirrors exactly. */
      return {
        refused: f.refusal
          ? `${fabric}: ${f.refusal}`
          : `${fabric} has no calculated requirement yet, so its yarn cannot be ` +
            "worked out — answer its weight on Manual",
      };
    }

    if (f.uom_id && uomId && f.uom_id !== uomId) {
      return {
        refused:
          "The fabrics using this yarn are measured in different units, so their " +
          "requirements cannot be added — give them one unit on Fabric Allocation",
      };
    }
    if (f.uom_id) uomId = f.uom_id;

    const combo = comboKey(f.combo);
    const net = f.gross * share;
    /* THE FABRIC'S ROUTE, RESOLVED TO THIS SLICE'S OWN PANELS FIRST (0528,
       wired 2026-09-15) — `stagesForGroup` is what keeps a component-wise
       route from stacking every panel's steps onto one weight. Resolved here
       rather than left to `comboUplift`'s own third argument so the refusal
       can name the FABRIC: "its components run different routes" is only a
       useful sentence once the reader knows whose. The yarn's own stages are
       appended after, unfiltered — they carry no `component_id`. */
    const route = stagesForGroup(
      routesByFabric.get(f.fabric_id) ?? [],
      combo,
      f.component_ids ?? [],
      "yarn_knit",
      /* 2026-09-19 — an unprinted slice's yarn is not grossed by the print
         stage's losses (`routeForPrint`). */
      f.printed,
    );
    if (isRefusal(route)) {
      return { refused: `${comp.fabric_name || "One fabric"}: ${route.refused}` };
    }
    /* THE DYE HOUSE'S LOSS, LAST (0568) — and the order of these two markups
       is the physical order read backwards. `factor` walks the CLOTH's route
       back from the cutting floor to grey-knitted weight; the yarn was dyed
       BEFORE it was knitted, so its own loss grosses what comes out of that,
       never the other way round. Legacy's own numbers pin it: 1021.000 kg of
       cloth-at-knitting becomes 1067.311 kg of grey yarn, not the reverse. */
    const dye = shadeDyeFactor(shades, f.fabric_id, yarnId, combo, f.yd_part ?? null);
    if (isRefusal(dye)) return { refused: `${comp.fabric_name || "One fabric"}: ${dye.refused}` };

    /* ONE DYEING LOSS, NOT TWO (client decision 2026-09-19). When this
       slice's shades carry a dye-house loss (`dye` above 1), that loss IS the
       yarn's dyeing loss — so a hand-typed YARN DYEING step (a yarn step in a
       coloured stage) leaves the PURCHASE arithmetic here, or the grey yarn
       would be grossed for dyeing twice. The step itself is KEPT: it still
       carries its `process_qty` to the Budget's Yarn Processes tab, where the
       dyeing charge per kg is typed. With no shade loss the typed step counts
       exactly as before. */
    const ownSteps = dye > 1 ? yarnOwnStages.filter((st) => !st.dyed) : yarnOwnStages;
    const factor = comboUplift([...route, ...ownSteps], combo);
    if (isRefusal(factor)) return factor;

    const gross = net * factor * dye;
    byFabric.push({ fabric_id: f.fabric_id, combo, net, gross, factor: factor * dye });
    comboNet.set(combo, (comboNet.get(combo) ?? 0) + net);
    comboGross.set(combo, (comboGross.get(combo) ?? 0) + gross);
    used++;
  }

  if (used === 0) {
    /* TWO WAYS TO HAVE NO WEIGHT, AND ONLY ONE OF THEM IS A PROBLEM (0564).
       Naming the second in its own words is what stops a correct Rule 2
       document reading as a broken Rule 1 one. */
    return {
      refused: boughtAsCloth
        ? "Every fabric using this yarn is bought as cloth, so no yarn is " +
          "purchased for it — see the fabric purchase requirement instead"
        : "No fabric on this BOM uses this yarn",
    };
  }

  const byCombo: YarnComboWeight[] = [];

  /* GREY YARN IS ONE LOT, SO IT IS ROUNDED ONCE (client 2026-09-19). Grey
     yarn is bought and knitted with no colour on it — the colour split begins
     at dyeing — so the purchase is ONE total per yarn, rounded UP once. It
     used to round each colourway up and add the results, which bought up to
     (colourways − 1) extra units of the last decimal and made the stored
     figure differ from the sum a reader works out. `byCombo` still carries
     each colourway's own rounded-up share: the colour-scoped yarn steps are
     charged on those (`stageProcessQty`), and a dyeing lot IS per colour. */
  let exact = 0;
  for (const [combo, gross] of [...comboGross].sort((a, b) => a[0].localeCompare(b[0]))) {
    byCombo.push({ combo, net: comboNet.get(combo) ?? 0, gross: ceilToPrecision(gross, dp) });
    exact += gross;
  }
  const qty = ceilToPrecision(exact, dp);

  return { qty, uom_id: uomId, byCombo, byFabric };
}

/** One purchased cloth's line of the answer, per colourway — the same shape
 *  `YarnComboWeight` takes one document up, because it is the same question
 *  asked of rolls instead of cones. */
export type ClothComboWeight = { combo: string; net: number; gross: number };

/**
 * THE RULE 2 DEMAND LINE (0564) — the roll weight to buy for ONE fabric the
 * factory does not knit.
 *
 * §2: "On the Material Requirement Sheet, the demand shifts directly to
 * Greige Fabric Roll Weight (in Kg) rather than raw grey yarn." This is the
 * figure that replaces the yarn `yarnPurchase` no longer buys, and it is the
 * DELIBERATE MIRROR of that function rather than a new kind of calculation —
 * same per-colourway split, same ladder, same round-up-per-lot, same
 * refusal-propagation — because the two are one arithmetic asked about two
 * goods, and a second shape would be a second place for them to drift.
 *
 * ## THE UNIT IS THE KILOGRAM AND IS NOT CONVERTED HERE
 *
 * `f.gross` is `order_fabric_bom_requirements.required_qty`, which has been a
 * weight in kilograms on every row since 0494 and has been LABELLED one since
 * 0562 ("a Manual entry states grams per garment and the engine divides by
 * 1,000"). So "roll weight in Kg" needs no conversion and gets none: what
 * changes under Rule 2 is what is being weighed, not the scale. A conversion
 * invented here would be a conversion between units that never differed —
 * 0562's own words about why it relabelled rather than multiplied.
 *
 * ## THE LADDER IS THE SUPPRESSED ONE, WHICH IS THE WHOLE POINT
 *
 * A greige roll arrives already knitted, so the knitting loss belongs to
 * whoever knitted it, and the weight to buy is the cutting-floor net grossed
 * by the losses the factory still incurs AFTER the roll lands — dyeing,
 * compacting, whatever the route declares. `stagesForGroup` with this
 * fabric's own `source` is exactly that list; passing `"yarn_knit"` here
 * would ask for enough greige to survive a knitting the factory is not doing
 * and over-buy every roll.
 *
 * ## IT TAKES `FabricGross[]` WHOLE AND FILTERS ITSELF
 *
 * Callers hold one array covering every fabric on the BOM (`fabricGrossOf`
 * builds exactly one), and handing this function a pre-filtered slice would
 * put the filter at four call sites. It also lets the "no requirement yet"
 * refusal below name the same fabric the yarn side would have named.
 */
export function clothPurchase(
  fabricId: string,
  source: FabricSource,
  fabrics: readonly FabricGross[],
  routesByFabric: ReadonlyMap<string, readonly RouteStage[]>,
  decimals: number | null,
  fabricName = "This fabric",
): { qty: number; uom_id: string | null; label: string; byCombo: ClothComboWeight[] } | Refusal {
  const label = clothPurchaseLabel(source);
  if (!label) {
    /* RULE 1 RAISES NO SUCH LINE, and this refuses rather than returning 0.
       A zero here would print a "Greige Fabric Roll Weight 0.000" row under
       a document that knits its own cloth — the "0 is not an answer" failure
       this module names in three other places. */
    return { refused: "This fabric is knitted in-house, so no cloth is purchased for it" };
  }

  const dp = uomPrecision(decimals);
  let uomId: string | null = null;
  let used = 0;
  const comboNet = new Map<string, number>();
  const comboGross = new Map<string, number>();

  for (const f of fabrics) {
    if (f.fabric_id !== fabricId) continue;

    if (f.gross == null) {
      /* THE ENGINE'S OWN SENTENCE WINS — `yarnPurchase`'s identical guard,
         which this loop otherwise mirrors exactly. */
      return {
        refused: f.refusal
          ? `${fabricName}: ${f.refusal}`
          : `${fabricName} has no calculated requirement yet, so the cloth to buy ` +
            "cannot be worked out — answer its weight on Manual",
      };
    }

    if (f.uom_id && uomId && f.uom_id !== uomId) {
      return {
        refused:
          "This fabric's requirement is stored in two different units, so the " +
          "roll weight cannot be added up — give it one unit on Fabric Allocation",
      };
    }
    if (f.uom_id) uomId = f.uom_id;

    const combo = comboKey(f.combo);
    const route = stagesForGroup(
      routesByFabric.get(fabricId) ?? [],
      combo,
      f.component_ids ?? [],
      source,
      f.printed,
    );
    if (isRefusal(route)) return { refused: `${fabricName}: ${route.refused}` };
    /* `comboUplift` OVER THE ALREADY-RESOLVED LIST, exactly as `yarnPurchase`
       does it: the resolution happens here so the refusal can name the fabric,
       and the uplift then walks a list that needs no further narrowing. */
    const factor = comboUplift(route, combo);
    if (isRefusal(factor)) return factor;

    comboNet.set(combo, (comboNet.get(combo) ?? 0) + f.gross);
    comboGross.set(combo, (comboGross.get(combo) ?? 0) + f.gross * factor);
    used++;
  }

  if (used === 0) return { refused: "This fabric has no requirement on this BOM" };

  const byCombo: ClothComboWeight[] = [];
  let qty = 0;
  /* ROUNDED PER COLOURWAY — `yarnPurchase`'s rule and its reason word for
     word: a purchase per colour is a real lot, and rounding a total DOWN buys
     less than the order needs. */
  for (const [combo, gross] of [...comboGross].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rounded = ceilToPrecision(gross, dp);
    byCombo.push({ combo, net: comboNet.get(combo) ?? 0, gross: rounded });
    qty += rounded;
  }

  return { qty: ceilToPrecision(qty, dp), uom_id: uomId, label, byCombo };
}

/**
 * What ONE step handles — the purchase weight of the colourways it treats.
 *
 * The Budget's Yarn Process line, and the reason it is not simply the yarn's
 * total (0529): a stage marked For = PURPLE is quoted on the purple lot alone.
 * A stage naming no combo covers all of them, so it does get the total.
 *
 * TWO STAGES ON ONE COLOURWAY EACH GET ITS FULL WEIGHT, which looks like a
 * double count and is not: the dyer and the winder each handle that lot and
 * each invoice for it. Two budget lines with two rates is the correct shape.
 *
 * IT STILL TAKES `byCombo` RATHER THAN THE TOTAL, so the Budget line and the
 * purchase weight are summed from the same rounded-up lots. Reading `qty` back
 * off `yarnPurchase` would be a second route to one figure, and the two would
 * part company in the last decimal the moment a colourway's lot rounded up.
 *
 * `toFixed(6)` BEFORE RETURNING, same reason `ceilToPrecision` already carries
 * it: summing two already-rounded decimals in IEEE754 can print `927.84` as
 * `927.8399999999999` (found 2026-09-11, once the backward-markup reversal
 * gave this a real two-fabric example to sum). This value is stored straight
 * to a Budget column — nothing downstream re-ceils it — so the noise has to
 * be cleaned HERE, not wherever it is next read.
 */
export function stageProcessQty(
  stageCombo: string | null,
  byCombo: readonly YarnComboWeight[],
): number {
  const sum = byCombo
    .filter((c) => stageCoversCombo(stageCombo, c.combo))
    .reduce((sum, c) => sum + c.gross, 0);
  return Number(sum.toFixed(6));
}

/**
 * Why this stage handles nothing, or null if it is fine. Restored 0529.
 *
 * THE CASE THIS EXISTS FOR is a stage naming a colourway the requirement does
 * not have — a combo removed from the order after the treatment was recorded, or
 * one whose spelling has since changed. Its `process_qty` would be 0, and a zero
 * on a cost line reads as "this dyeing is free" rather than as "this row matches
 * nothing", which is the one reading nobody questions.
 *
 * A stage naming no PROCESS is not a problem and gets no reason: it is a row the
 * planner has started and not finished, and it simply produces no budget line.
 */
export function stageProblem(
  stageCombo: string | null,
  byCombo: readonly YarnComboWeight[],
): string | null {
  if (byCombo.length === 0) return null;
  if (comboKey(stageCombo) === "") return null;
  const covered = byCombo.some((c) => stageCoversCombo(stageCombo, c.combo));
  return covered
    ? null
    : `This BOM needs no ${stageCombo} of this yarn — check the For column against the order's colourways`;
}

/** Has the planner recorded anything under this yarn? Read by the `done` dot,
 *  which asks whether the tab has been LOOKED at rather than whether every yarn
 *  is treated — a solid order's correct answer is no stages at all. */
export function yarnRowAnswered(r: YarnRow): boolean {
  return r.stages.some(
    (s) =>
      !!s.stage_id ||
      !!s.process_id ||
      !!s.loss_for_id ||
      !!s.combo.trim() ||
      !!s.description.trim() ||
      !!s.loss_pct.trim(),
  );
}

/**
 * Has the planner started this STAGE row?
 *
 * Two readers, as everywhere else in this repo: the save path drops a row this
 * calls false, and the screen marks its cells `required` only when it calls true.
 * One function, so they cannot disagree — a disagreement is either an operator
 * caged on a row about to be discarded, or a half-filled row vanishing on save.
 */
export function yarnStageStarted(
  s: Pick<
    YarnStageRow,
    "stage_id" | "process_id" | "loss_for_id" | "combo" | "description" | "loss_pct"
  >,
): boolean {
  return (
    !!s.stage_id ||
    !!s.process_id ||
    !!s.loss_for_id ||
    !!s.combo.trim() ||
    !!s.description.trim() ||
    !!s.loss_pct.trim()
  );
}

/**
 * The processes offered on a yarn.
 *
 * `currentValue` is the id this row already holds; it is re-admitted AFTER the
 * filter, never before it, so it survives without widening the list for any
 * other row. That is the "Disabled rows" rule and it is the whole reason this
 * narrowing is not a `.eq("for_yarn", true)` in SQL.
 *
 * Signature and shape are `processesForFabric`'s, deliberately: two functions
 * that differ only in a flag should read as two spellings of one rule, so a fix
 * to either is obviously owed to the other.
 */
export function processesForYarn(
  options: readonly YarnProcessOption[],
  opts: { currentValue?: string | null } = {},
): YarnProcessOption[] {
  const held = opts.currentValue ?? null;
  const flagged = options.filter((p) => p.for_yarn);
  if (!held || flagged.some((p) => p.id === held)) return flagged;
  const kept = options.find((p) => p.id === held);
  return kept ? [...flagged, kept] : flagged;
}

/**
 * One stage as the payload carries it.
 *
 * NO `process_qty`. It is computed server-side in the same write as the
 * requirement it divides — the identical division
 * `order_fabric_bom_requirements` draws ("written by the server, never by the
 * form"). A client that could post a processed weight could post any processed
 * weight, and the Budget prices it.
 */
export const fabricBomYarnStageInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  stage_id: z.string().uuid().nullable().default(null),
  process_id: z.string().uuid().nullable().default(null),
  /* THE `For` COLUMN'S LABEL — `config_lookups` kind `process_loss_for`, the
     same list the fabric route's `Loss for` posts. PROCESS WISE or COLOR WISE;
     no arithmetic reads it, `combo` below does (0529). */
  loss_for_id: z.string().uuid().nullable().default(null),
  /* THE `For` COLUMN'S ARITHMETIC (0504, restored 0529). CAPSED, like every
     other free-text column in this module — AGENTS.md's CAPITALS section puts
     the transform here rather than in the action, since `lib/data-io` parses
     imports with these same schemas — and load-bearing rather than cosmetic:
     the value is MATCHED against the requirement rows' own combo, capsed by the
     same rule (`comboKey`). */
  combo: z
    .string()
    .trim()
    .toUpperCase()
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
  /* CAPSED IN THE SCHEMA, like every other free-text column in this module.
     AGENTS.md's CAPITALS section puts the transform here rather than in the
     action — `lib/data-io` parses imports with these same schemas — and withdrew
     the free-text exemption on 2026-08-18. */
  description: z
    .string()
    .trim()
    .toUpperCase()
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
  loss_pct: z.coerce.number().min(0).lt(100).nullable().default(null),
});

/**
 * One yarn, with its stages.
 *
 * `item_id` IS REQUIRED where every other grid in this module makes every field
 * optional, and the difference is that these rows are not typed. There is no
 * half-filled state to protect: a row without a yarn was not created by a planner
 * reaching the second cell, it is a bug.
 */
export const fabricBomYarnInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  item_id: z.string().uuid(),
  stages: z.array(fabricBomYarnStageInput).default([]),
});

export type FabricBomYarnInput = z.infer<typeof fabricBomYarnInput>;
export type FabricBomYarnStageInput = z.infer<typeof fabricBomYarnStageInput>;

/* THE NORMALIZER IS NOT HERE, DELIBERATELY — `normalizeYarns` lives in
   actions.ts beside `normalizeLines`, `normalizeDias` and `normalizeProcesses`,
   which answer the identical question for the children written in the same pass
   and need the same requirement rows. A second copy here would be a second
   answer to "which rows is this save keeping?". `./processes.ts` records the
   same division. */
