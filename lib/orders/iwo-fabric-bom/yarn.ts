/**
 * IWO Fabric BOM — the inputs the order Fabric BOM's yarn engine needs, built
 * from an IWO's TYPED weights (step 3).
 *
 * ## THE ENGINE IS THE ORDER'S, UNCHANGED
 *
 * `yarnPurchase`, `comboUplift` and `stageProcessQty` (lib/orders/fabric-bom/
 * yarn-process.ts) are called as they are: the loss rule (divide by 1 − L,
 * compounded — the client's decision, and legacy's own arithmetic), the blend
 * split (`yarnShareOf`), the stage kinds and the rounding are theirs. What an
 * order computes from pieces × grams per garment, an IWO simply HAS — the
 * planner typed Req Wt (SRS §4) — so this file replaces only the first link of
 * the chain: where the fabric's gross weight comes from.
 *
 * ## PURE, AND READ TWICE
 *
 * The screen previews with these functions and the action stores with them.
 * The order screen's own history is the reason: its preview and its stored
 * figure diverged twice when each built these maps separately.
 *
 * NO COLOURWAY, NO COMPONENT. `combo` is null on every gross and every route
 * step, which `comboKey` reads as "" — so only steps that name no colour apply,
 * and on an IWO no step can name one.
 */

import {
  comboUplift,
  isRefusal,
  type FabricGross,
  type Refusal,
  type RouteStage,
  type YarnComboWeight,
} from "@/lib/orders/fabric-bom/yarn-process";
import { ceilToPrecision, uomPrecision } from "@/lib/uom/convert";

/** One fabric line as this file reads it. */
export type IwoGrossLine = { item_id: string | null; req_kgs: number | null };

/** One route step as this file reads it. `loss_pct` may be NaN (typed text). */
export type IwoRouteStep = {
  item_id: string;
  stage_id: string | null;
  process_id: string | null;
  loss_pct: number | null;
};

/**
 * The gross KGS per fabric — the IWO's replacement for the order's
 * consumption × pieces requirement. Lines of one fabric SUM (two colours of
 * one cloth are one yarn purchase, split by blend, not by colour).
 *
 * A LINE WITH NO WEIGHT POISONS ITS FABRIC, the order engine's own rule: a
 * yarn covering one weighed line and one unweighed one has no total worth
 * printing, and two thirds of an answer looks like a whole one. The refusal
 * names the fix.
 *
 * NO KGS ROW IN THE UOM MASTER REFUSES TOO, rather than guessing a unit.
 */
export function iwoFabricGross(
  lines: readonly IwoGrossLine[],
  kgUomId: string | null,
  fabricName: (itemId: string) => string,
): FabricGross[] {
  const byFabric = new Map<string, FabricGross>();
  for (const l of lines) {
    if (!l.item_id) continue;
    const held = byFabric.get(l.item_id);
    if (held && held.gross === null) continue;
    const kg = l.req_kgs;
    const refusal = !kgUomId
      ? "The UOM master has no active KGS row, so no yarn weight can be stated."
      : kg == null || !(kg > 0)
        ? `Enter the Req Wt for ${fabricName(l.item_id)} on Fabric Consumption.`
        : null;
    byFabric.set(l.item_id, {
      fabric_id: l.item_id,
      combo: null,
      gross: refusal ? null : (held?.gross ?? 0) + (kg as number),
      uom_id: kgUomId,
      component_ids: [],
      refusal,
    });
  }
  return [...byFabric.values()];
}

/**
 * Each fabric's route, in the engine's shape — the order screen's
 * `routesByFabric` and the order action's `routesByFabricOf`, minus the
 * colourway and component axes. `kinds` carries the process master's
 * Knitting / Dyeing flags (0564); without them a route suppresses nothing
 * under a purchased-cloth source.
 */
export function iwoRoutesByFabric(
  steps: readonly IwoRouteStep[],
  kinds: ReadonlyMap<string, { is_knitting: boolean; is_dyeing: boolean }>,
): Map<string, RouteStage[]> {
  const out = new Map<string, RouteStage[]>();
  for (const p of steps) {
    if (!p.process_id) continue;
    const kind = kinds.get(p.process_id);
    const list = out.get(p.item_id) ?? [];
    list.push({
      combo: null,
      component_id: null,
      loss_pct: p.loss_pct,
      stage_id: p.stage_id,
      process_id: p.process_id,
      is_knitting: kind?.is_knitting ?? false,
      is_dyeing: kind?.is_dyeing ?? false,
    });
    out.set(p.item_id, list);
  }
  return out;
}

/**
 * FOR = YARN (step 4, screenshot 2937): the yarn is PICKED and WEIGHED, not
 * derived from a cloth, so there is no fabric, no blend and no fabric route.
 * The planned weight goes through the yarn's OWN stages only — the same
 * `comboUplift` rule (divide by 1 − L, compounded) and the same round-UP
 * `yarnPurchase` applies, so a Yarn IWO and a Fabric IWO gross a 10% dyeing
 * loss identically.
 *
 * Returns the order engine's success shape (`byCombo` with one uncoloured
 * bucket) so `stageProcessQty` answers each stage's quantity exactly as it
 * does on an order.
 */
export function iwoYarnModePurchase(
  plannedKgs: number | null,
  ownStages: readonly { loss_pct: number | null }[],
  kgUomId: string | null,
  decimals: number | null,
  yarnName: string,
): { qty: number; uom_id: string | null; byCombo: YarnComboWeight[] } | Refusal {
  if (!kgUomId) return { refused: "The UOM master has no active KGS row, so no yarn weight can be stated." };
  if (plannedKgs == null || !(plannedKgs > 0)) {
    return { refused: `Enter the Planned Weight for ${yarnName} on Yarn Lines.` };
  }
  const factor = comboUplift(
    ownStages.map((s) => ({ combo: null, loss_pct: s.loss_pct })),
    "",
    [],
  );
  if (isRefusal(factor)) return factor;
  const gross = ceilToPrecision(plannedKgs * factor, uomPrecision(decimals));
  return { qty: gross, uom_id: kgUomId, byCombo: [{ combo: "", net: plannedKgs, gross }] };
}
