/**
 * "Which yarns does this BOM buy, what treatment does each need, and how much of
 * it must be bought?" — the Fabric BOM ▸ Yarn Process tab (0493 · 0504).
 *
 * Client spec 2026-09-01 (second pass); legacy screenshot 2587. Storage and the
 * full reasoning are in `supabase/migrations/0504_fabric_bom_yarn_stages.sql`;
 * this file is the rules, and it is client-safe on purpose (no `server-only`) so
 * the screen shows the same figure the save path stores. The server half is
 * `getBomYarnComposition()` in `./service.ts`.
 *
 * ## FOUR RULES, AND THEY ARE THE WHOLE FILE
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
 *
 * ## TWO ARITHMETIC DECISIONS, BOTH THE CLIENT'S, BOTH DELIBERATELY UNUSUAL
 *
 * **The per-stage form is `x (1 + loss/100)`**, not `order_fabric_plan_stages`'
 * backward solve `/ (1 - loss/100)`. 0427's header argues at length that the
 * uplift under-buys; the client was shown both figures against their own example
 * and chose this one (2026-09-01).
 *
 * **Stages compound sequentially**: 3% then 2% is `x 1.03 x 1.02` = 5.06%, not
 * 5.00%. Confirmed against that exact pair.
 *
 * Both are decisions to re-open with the client, never bugs to quietly correct.
 * `scripts/check-yarn-process.mts` REFUTES the alternative answer for each —
 * 111.12 for the first, 1050.00 for the second — so a "tidy-up" fails loudly.
 *
 * ## IT COMPUTES ONCE AND IS READ TWICE
 *
 * The screen previews it as the planner types and `writeYarns` stores what it
 * returns, exactly as `fabricRequirementRows` is used one section up. Two
 * implementations of one formula is how a preview and a saved figure come to
 * disagree, and here the saved one is what a yarn purchase is raised against.
 */

import { z } from "zod";
import { ceilToPrecision, uomPrecision } from "@/lib/uom/convert";
import { isRefusal, type Refusal } from "./requirement";

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
  combo: string | null;
  /** Net cloth required for this slice, in `uom_id`. NULL when the requirement
   *  engine refused it — carried, not dropped, so the yarn row can say WHY it
   *  has no weight rather than silently reading zero. */
  gross: number | null;
  uom_id: string | null;
};

/** The bucket key for a colourway. One function so the screen, the engine and
 *  the save path cannot spell "no colourway" three different ways. */
export const comboKey = (combo: string | null | undefined): string =>
  (combo ?? "").trim().toUpperCase();

/**
 * One treatment a yarn runs, in client state — the child grid's row.
 *
 * `combo` IS `""` FOR "EVERY COLOURWAY", which is the ordinary case and what a
 * blank box means. Stored as NULL; the empty string lives here because the cell
 * is a `<select>` whose empty value is `""`.
 */
export type YarnStageRow = {
  key: string;
  stage_id: string | null;
  process_id: string | null;
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
      return {
        refused:
          `${comp.fabric_name || "One fabric"} has no calculated requirement yet, ` +
          "so its yarn cannot be worked out — see Calculated Quantities",
      };
    }

    if (f.uom_id && uomId && f.uom_id !== uomId) {
      return {
        refused:
          "The fabrics using this yarn are measured in different units, so their " +
          "requirements cannot be added — give them one unit on Fabric Lines",
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
 * Does this stage treat this colourway?
 *
 * A BLANK `combo` MEANS EVERY COLOURWAY — the ordinary case, and the only thing
 * a blank box can mean here. Reading it as "no colourway" would make a stage the
 * planner filled in apply to nothing, and the arithmetic would silently ignore a
 * loss they deliberately entered.
 */
export const stageCoversCombo = (stageCombo: string | null, combo: string): boolean =>
  comboKey(stageCombo) === "" || comboKey(stageCombo) === combo;

/**
 * One colourway's gross-up factor: the SEQUENTIAL product of the stages treating
 * it.
 *
 * `x 1.03 x 1.02`, NOT `x 1.05`. Each stage's loss applies to what came out of
 * the one before it, which is the client's confirmed reading (2026-09-01) and
 * what "compounding" means physically. The additive alternative under-buys by a
 * little on every yarn, always in the same direction, and each line still looks
 * right — the shape 0427's header describes for its own formula.
 *
 * ORDER DOES NOT CHANGE THE PRODUCT, and that is worth stating rather than
 * relying on: multiplication commutes, so re-ordering the stages moves nothing.
 * `sno` orders what the planner READS, not what the arithmetic does.
 */
export function comboUplift(
  stages: readonly { combo: string | null; loss_pct: number | null }[],
  combo: string,
): number | Refusal {
  let factor = 1;
  for (const s of stages) {
    if (!stageCoversCombo(s.combo, combo)) continue;
    const loss = s.loss_pct ?? 0;
    if (loss < 0 || loss >= 100) {
      return { refused: "Process loss must be 0 or more and below 100" };
    }
    factor *= 1 + loss / 100;
  }
  return factor;
}

/** One colourway's line of the answer. */
export type YarnComboWeight = { combo: string; net: number; gross: number };

/**
 * The yarn to buy, and the breakdown that produced it.
 *
 * Each colourway's net is grossed by the stages that treat it, ROUNDED UP to the
 * unit's own precision, and summed. Rounding per colourway rather than once at
 * the end is deliberate: a purchase per colour is a real lot, and rounding a
 * total DOWN buys less yarn than the order needs.
 *
 * REFUSALS PROPAGATE AND ARE NOT SWALLOWED. A yarn whose share cannot be worked
 * out for one of its fabrics has no total worth printing: two thirds of an answer
 * that looks like a whole one is exactly the shape a buyer would act on.
 */
export function yarnPurchase(
  yarnId: string,
  fabrics: readonly FabricGross[],
  compositions: ReadonlyMap<string, FabricComposition>,
  stages: readonly { combo: string | null; loss_pct: number | null }[],
  decimals: number | null,
): { qty: number; uom_id: string | null; byCombo: YarnComboWeight[] } | Refusal {
  const base = yarnNetByCombo(yarnId, fabrics, compositions);
  if (isRefusal(base)) return base;

  const dp = uomPrecision(decimals);
  const byCombo: YarnComboWeight[] = [];
  let qty = 0;

  for (const [combo, net] of [...base.net].sort((a, b) => a[0].localeCompare(b[0]))) {
    const uplift = comboUplift(stages, combo);
    if (isRefusal(uplift)) return uplift;
    const gross = ceilToPrecision(net * uplift, dp);
    byCombo.push({ combo, net, gross });
    qty += gross;
  }

  return { qty: ceilToPrecision(qty, dp), uom_id: base.uom_id, byCombo };
}

/**
 * What ONE stage handles — the purchase weight of the colourways it treats.
 *
 * The Budget's Yarn Process line, and the reason it is not simply the yarn's
 * total: a stage marked For = PURPLE is quoted on the purple lot alone. A stage
 * naming no combo covers all of them, so it does get the total.
 *
 * TWO STAGES ON ONE COLOURWAY EACH GET ITS FULL WEIGHT, which looks like a
 * double count and is not: the dyer and the winder each handle that lot and each
 * invoice for it. Two budget lines with two rates is the correct shape.
 */
export function stageProcessQty(
  stageCombo: string | null,
  byCombo: readonly YarnComboWeight[],
): number {
  return byCombo
    .filter((c) => stageCoversCombo(stageCombo, c.combo))
    .reduce((sum, c) => sum + c.gross, 0);
}

/**
 * Why this stage handles nothing, or null if it is fine.
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
  s: Pick<YarnStageRow, "stage_id" | "process_id" | "combo" | "description" | "loss_pct">,
): boolean {
  return (
    !!s.stage_id ||
    !!s.process_id ||
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
  /* CAPSED IN THE SCHEMA, like every other free-text column in this module.
     AGENTS.md's CAPITALS section puts the transform here rather than in the
     action — `lib/data-io` parses imports with these same schemas — and withdrew
     the free-text exemption on 2026-08-18. For `combo` it is load-bearing rather
     than cosmetic: the value is MATCHED against the requirement rows' own combo,
     which is capsed by the same rule, so capsing here is what keeps the match
     working. */
  combo: z
    .string()
    .trim()
    .toUpperCase()
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
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
