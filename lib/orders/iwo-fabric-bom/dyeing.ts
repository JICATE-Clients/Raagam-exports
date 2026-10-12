/**
 * IWO Fabric Plan ▸ DYEING WORK ORDER — what goes to the dye house, per fabric
 * and colour (client decision 2026-10-12, Sample ▸ Fabric Plan / SWO).
 *
 * ## THE QUANTITY IS THE GREIGE WEIGHT
 *
 *   Greige (Issue Qty)  = Required Finished Weight ÷ (1 − Dyeing Loss %)
 *   Finished (Return Qty) = the plan's Req Wt, as typed
 *
 * The dye house processes and invoices on the greige weight it RECEIVES, so
 * that is the work order's quantity (`process_order_lines.sent_qty`). The
 * finished weight rides beside it (`return_qty`, 0708) for the stores team to
 * check the net weight when the cloth comes back. Both print on the document.
 *
 * ## WHAT IS DYED, AND AT WHAT LOSS
 *
 * - A line is dyed when it carries a COLOUR and its fabric's route has a
 *   DYEING step (`processes.is_dyeing`). A greige line (no colour) is not sent;
 *   a fabric whose route never dyes (a yarn-dyed or a bought-dyed cloth) is not
 *   either — its colour came from somewhere else.
 * - The loss is the route's DYEING steps only — the client's formula names the
 *   dyeing loss, not knitting or compacting — read per colour through the order
 *   engine's own `lossForCombo` (a COLOR WISE step's map first, else its flat
 *   %), so a colour grosses here exactly as it does in the yarn calculation.
 *   Two dyeing steps compound: 1 − (1 − a)(1 − b), the engine's rule.
 * - Lines of one fabric and colour SUM across dias and SMPs: the SWO raises ONE
 *   dyeing work order per lot (spec §3.3), not one per sample.
 *
 * The greige is rounded UP to the gram, so the issue is never a fraction short
 * of what the finished weight needs. PURE: the action stores with it and
 * `check:iwo-fabric-bom` §20 pins it.
 */

import { comboKey, lossForCombo } from "@/lib/orders/fabric-bom/yarn-process";

export type DyeingPlanLine = { item_id: string | null; color_name: string | null; req_kgs: number | null };
export type DyeingRouteStep = {
  item_id: string;
  process_id: string | null;
  loss_pct: number | null;
  color_losses?: Readonly<Record<string, number>> | null;
};

export type DyeingWorkOrderLine = {
  item_id: string;
  /** As the plan spells it (first line met). */
  color_name: string;
  /** Target finished weight — the Return Qty. */
  finished_kg: number;
  /** The dyeing loss applied, compounded, in %. */
  loss_pct: number;
  /** Greige weight — the Issue Qty the dye house processes and invoices. */
  greige_kg: number;
};

const round3 = (v: number) => Math.round(v * 1000) / 1000;
/** Up to the gram; the tolerance keeps 2.1000000000000001 from buying a gram. */
const ceil3 = (v: number) => Math.ceil(v * 1000 - 1e-6) / 1000;

export function dyeingWorkOrderLines(
  lines: readonly DyeingPlanLine[],
  steps: readonly DyeingRouteStep[],
  isDyeing: (processId: string) => boolean,
): DyeingWorkOrderLine[] {
  const dyeSteps = new Map<string, DyeingRouteStep[]>();
  for (const st of steps) {
    if (!st.process_id || !isDyeing(st.process_id)) continue;
    const held = dyeSteps.get(st.item_id);
    if (held) held.push(st);
    else dyeSteps.set(st.item_id, [st]);
  }

  const buckets = new Map<string, { item_id: string; color_name: string; finished: number }>();
  for (const l of lines) {
    const colour = (l.color_name ?? "").trim();
    if (!l.item_id || !colour || !(l.req_kgs != null && l.req_kgs > 0)) continue;
    if (!dyeSteps.has(l.item_id)) continue;
    const key = `${l.item_id}|${comboKey(colour)}`;
    const held = buckets.get(key);
    if (held) held.finished += l.req_kgs;
    else buckets.set(key, { item_id: l.item_id, color_name: colour, finished: l.req_kgs });
  }

  return [...buckets.values()].map((b) => {
    const keep = (dyeSteps.get(b.item_id) ?? []).reduce((k, st) => {
      const pct = lossForCombo({ loss_pct: st.loss_pct, color_losses: st.color_losses ?? undefined }, b.color_name) ?? 0;
      return k * (1 - Math.min(Math.max(pct, 0), 99.999) / 100);
    }, 1);
    const finished = round3(b.finished);
    return {
      item_id: b.item_id,
      color_name: b.color_name,
      finished_kg: finished,
      loss_pct: round3((1 - keep) * 100),
      greige_kg: ceil3(finished / keep),
    };
  });
}
