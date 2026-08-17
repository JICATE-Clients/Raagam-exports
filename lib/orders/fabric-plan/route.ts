/**
 * Fabric Plan — the route that makes the fabric, and what it costs in material.
 *
 * Step 6 of the client's order flow (client, 2026-08-17). Fabric BOM (step 5)
 * says how much FINISHED FABRIC the order needs. This walks the route that
 * produces it — yarn purchase → knitting → dyeing → stentering → compacting —
 * applying each stage's loss, and arrives at the quantity of yarn to buy.
 *
 * ## THE ARITHMETIC RUNS BACKWARDS, AND THAT IS THE WHOLE THING
 *
 * Loss is stated forward ("knitting loses 4%") and the requirement is known at
 * the END of the chain, so each stage is solved from its output:
 *
 *     input = output / (1 - loss/100)
 *
 * NOT `output x (1 + loss/100)`. The two agree at 0% and diverge immediately
 * after: at 10% loss on 100 kg of output the correct input is 111.12 kg, and the
 * plausible-looking alternative gives 110 — which then loses 11 and delivers 99.
 * Every stage is 1% short in the same direction, so a five-stage route arrives
 * ~5% under on the largest purchase in the order, and each individual line looks
 * right. `check-fabric-plan.mts` §2 exists to make those two disagree.
 *
 * ## WHY LOSS IS NOT ON THE BOM
 *
 * 0426's header states the boundary and this is the other side of it: the BOM's
 * `wastage_pct` is the CUTTING room's buffer on finished fabric. Process loss
 * belongs here. Putting knitting loss on the BOM as well charges it twice, on the
 * largest line in the order, and looks entirely plausible on both screens.
 *
 * Client-safe (no `server-only`) for the reason the two BOM engines are: the
 * figures recalculate as the operator types, so they run in the browser — and the
 * server action stores what these same functions produce, which is what stops the
 * number the operator approved and the number a purchase order is checked against
 * from being derived twice.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * Inherited from both BOM engines. A stage that cannot answer returns a `Refusal`
 * carrying the sentence the screen prints; it never returns 0, which on a yarn
 * purchase reads as "buy nothing".
 */

import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";
import { ceilToPrecision, uomPrecision } from "@/lib/uom/convert";

export { isRefusal };
export type { Refusal };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Who performs a stage.
 *
 * The same two words `order_garment_processes` (0019) uses for the garment side,
 * spelled the same way — `mode in ('in_house','outsourced')`. Reusing the
 * vocabulary is deliberate: a fabric route and a garment process plan answer the
 * identical question about a stage, and two spellings of one answer is what
 * AGENTS.md records under Nominated vendors as compiling, running and quietly
 * matching nothing.
 */
export const STAGE_MODES = ["in_house", "outsourced"] as const;
export type StageMode = (typeof STAGE_MODES)[number];

export const STAGE_MODE_LABELS: Record<StageMode, string> = {
  in_house: "In-house",
  outsourced: "Out-processed",
};

export function stageModeOf(v: string | null | undefined): StageMode | Refusal {
  const k = (v ?? "").trim().toLowerCase();
  return (STAGE_MODES as readonly string[]).includes(k)
    ? (k as StageMode)
    : { refused: "Say whether this stage is in-house or out-processed" };
}

/** One stage of a route, as much of it as the arithmetic needs. */
export type StageInput = {
  /** Position in the route. The LAST stage is the one that outputs the finished
   *  fabric; the FIRST is what has to be bought. */
  sno: number;
  /** The process. Only its presence matters here — the name is the screen's. */
  process_id: string | null;
  mode: string | null;
  /** Who does it, when it is out-processed. */
  vendor_id: string | null;
  /** Percentage of the INPUT lost at this stage. */
  loss_pct: number | null;
};

/** What one stage turns into what. */
export type StageQuantity = {
  sno: number;
  /** What must go in. The first stage's input is the material to buy. */
  input: number;
  /** What comes out — the next stage's input, or the BOM requirement at the end. */
  output: number;
  /** input − output. Shown so the loss is a figure rather than a percentage the
   *  operator has to apply in their head. */
  lost: number;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

/**
 * Check a route before any arithmetic runs on it.
 *
 * SEPARATE FROM `routeQuantities` ON PURPOSE. The screen shows these problems
 * against the STAGE that carries them while the operator is still typing, and
 * the quantities are blank until they are fixed — so a route that cannot compute
 * says which row is wrong rather than producing one refusal for the whole thing.
 */
export function stageProblem(stage: StageInput): string | null {
  if (!stage.process_id) return "Choose the process for this stage";

  const mode = stageModeOf(stage.mode);
  if (isRefusal(mode)) return mode.refused;
  // A vendor is required for out-processing and meaningless in-house — the
  // "property of the field FOR A STATE" case AGENTS.md records under Mandatory
  // fields, so it lives in this one function rather than as a second rule beside
  // the screen's.
  if (mode === "outsourced" && !stage.vendor_id) return "Name the processor for an out-processed stage";

  const loss = num(stage.loss_pct);
  if (loss == null) return "Enter this stage's loss %, or 0 if there is none";
  if (loss < 0) return "Loss cannot be negative";
  // 100% LOSS IS NOT A BIG NUMBER, IT IS A DIVISION BY ZERO. In JS `x / 0` is
  // Infinity rather than a throw, so an unguarded value escapes into the UI as an
  // ordinary-looking figure and onto a purchase order — `conversionFactor`'s
  // stated reason for refusing a zero divisor, one formula along.
  if (loss >= 100) return "Loss must be less than 100% — nothing would come out";

  return null;
}

/**
 * Solve a route backwards from the finished-fabric requirement.
 *
 * `required` is the BOM's stored requirement for this fabric — never recomputed
 * here. `decimals` is the consumption UOM's `decimal_places_allowed`.
 *
 * ## EVERY STAGE ROUNDS UP, AND IT ROUNDS AT THE STAGE
 *
 * The alternative is to solve the whole chain exactly and round once at the end.
 * That produces a smaller, tidier number and the wrong one: each stage's input is
 * a real quantity that gets issued, knitted or bought, so it is the figure a
 * store-keeper acts on. Rounding the chain and then apportioning back would leave
 * an intermediate stage a fraction short, and a fraction short at knitting is a
 * fabric roll that does not finish.
 *
 * The compounding this causes is bounded and in the safe direction: at most one
 * unit of the UOM's own precision per stage — under 0.05 kg across a five-stage
 * route at two decimals. The failure it prevents is a shortfall, which is the one
 * `ceilToPrecision` exists to prevent everywhere else in this app.
 */
export function routeQuantities(
  stages: readonly StageInput[],
  required: number,
  decimals: number | null,
): StageQuantity[] | Refusal {
  if (stages.length === 0) {
    return { refused: "This fabric has no process route yet" };
  }
  const q = num(required);
  if (q == null || q <= 0) {
    return { refused: "No requirement to plan against — record the Fabric BOM first" };
  }

  for (const s of stages) {
    const problem = stageProblem(s);
    // NAMES THE STAGE. "Loss must be less than 100%" with no position is
    // unactionable on a five-stage route.
    if (problem) return { refused: `Stage ${s.sno}: ${problem}` };
  }

  const dp = uomPrecision(decimals);
  // Sorted here rather than trusted from the caller: the screen renders rows in
  // grid order and a re-ordered route that computed in the old order would be
  // wrong in a way nothing on screen shows.
  const ordered = [...stages].sort((a, b) => a.sno - b.sno);

  const out: StageQuantity[] = [];
  let output = q;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const loss = num(ordered[i].loss_pct) ?? 0;
    const input = ceilToPrecision(output / (1 - loss / 100), dp);
    out.unshift({ sno: ordered[i].sno, input, output, lost: round(input - output, dp) });
    output = input;
  }
  return out;
}

/** `input - output` can carry a float artefact (`111.12 - 100` is fine, but
 *  `0.3 - 0.1` is not), and this figure is only ever displayed — so it rounds to
 *  nearest rather than up. Rounding a DISPLAYED difference up would make the
 *  three columns fail to add up on screen, which is worse than the artefact. */
function round(v: number, dp: number): number {
  const scale = 10 ** dp;
  return Math.round(v * scale) / scale;
}

/**
 * What has to be bought — the first stage's input.
 *
 * THE FIRST STAGE IS THE PURCHASE, and that is a claim about the route rather
 * than about this function: a route that begins at Knitting is planning from
 * yarn the company already holds, and its first input is an issue rather than a
 * purchase. Both are "what must be available before the route can start", which
 * is the only thing this returns; naming it a purchase is the screen's job, and
 * it does not.
 */
export function routeInput(rows: readonly StageQuantity[]): number | Refusal {
  const first = rows[0];
  return first ? first.input : { refused: "This fabric has no process route yet" };
}

/** Total material lost across the route — the figure that justifies the yarn
 *  quantity being larger than the fabric quantity. */
export function routeLoss(rows: readonly StageQuantity[]): number {
  return rows.reduce((a, r) => a + r.lost, 0);
}
