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
 * NO COLOURWAY, NO COMPONENT — BUT A LINE'S COLOUR IS A BUCKET. An IWO has no
 * colourways, so a fabric line's own Colour stands in for one (2026-09-20,
 * `iwoFabricGross`): that is what a Yarn Dyed fabric's per-colour dyeing loss
 * is matched against. Route steps name no colour (`combo` null), so they apply
 * to every bucket. A DYED Yarn IWO's shades are buckets the same way (0592,
 * `iwoYarnModePurchase`).
 *
 * COLOUR-WISE LOSS RIDES ON THOSE BUCKETS (0613, the order's 0606). A step
 * whose For is COLOR WISE carries `color_losses` — line Colour or shade → % —
 * and this file only CARRIES the map: it is resolved by `lossForCombo` inside
 * `stagesForGroup`, which `comboUplift` / `yarnPurchase` walk per bucket. The
 * keys match because both sides go through `comboKey`. Nothing here branches
 * on it, so a step with no map grosses exactly as it did before.
 */

import {
  comboKey,
  comboUplift,
  isRefusal,
  type FabricComposition,
  type FabricGross,
  type Refusal,
  type RouteStage,
  type YarnComboWeight,
  type YarnShade,
} from "@/lib/orders/fabric-bom/yarn-process";
import { yarnShadesFrom } from "@/lib/orders/fabric-bom/yarn-dyed";
import { ceilToPrecision, uomPrecision } from "@/lib/uom/convert";

/** One fabric line as this file reads it. `color_name` (0599, the Details
 *  popup) makes each colour its own bucket — see `iwoFabricGross`. */
export type IwoGrossLine = { item_id: string | null; req_kgs: number | null; color_name?: string | null };

/** One route step as this file reads it. `loss_pct` may be NaN (typed text). */
export type IwoRouteStep = {
  item_id: string;
  stage_id: string | null;
  process_id: string | null;
  loss_pct: number | null;
  /** 0613 — per line-Colour losses of a COLOR WISE step; absent = flat loss. */
  color_losses?: Readonly<Record<string, number>> | null;
};

/**
 * The gross KGS per fabric AND COLOUR — the IWO's replacement for the order's
 * consumption × pieces requirement.
 *
 * ONE BUCKET PER (FABRIC, COLOUR) since 2026-09-20. On an order the colour
 * axis is the colourway; an IWO has none, so a line's own Colour plays that
 * part — which is what lets a Yarn Dyed fabric's per-colour dyeing losses
 * (Details ▸ Yarn Dyed Details ▸ Combinations, keyed by that colour) gross the
 * right colour's weight inside `yarnPurchase`. Lines of one fabric and colour
 * SUM (two dias of one colour are one lot); a line with no colour keeps the
 * uncoloured bucket, exactly the old behaviour. The yarn purchase still sums
 * every bucket, so splitting by colour changes nothing for a solid cloth.
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
    const colour = comboKey(l.color_name);
    const bucket = `${l.item_id}|${colour}`;
    const held = byFabric.get(bucket);
    if (held && held.gross === null) continue;
    const kg = l.req_kgs;
    const refusal = !kgUomId
      ? "The UOM master has no active KGS row, so no yarn weight can be stated."
      : kg == null || !(kg > 0)
        ? `Enter the Req Wt for ${fabricName(l.item_id)} on Fabric Consumption.`
        : null;
    byFabric.set(bucket, {
      fabric_id: l.item_id,
      combo: colour || null,
      gross: refusal ? null : (held?.gross ?? 0) + (kg as number),
      uom_id: kgUomId,
      component_ids: [],
      refusal,
    });
  }
  return [...byFabric.values()];
}

/** A Yarn Dyed Details repeat / combination as `iwoYarnShades` reads it —
 *  the stored row, the payload row and the screen's row all fit. */
export type IwoYdRepeatLike = {
  item_id: string | null;
  sno: number;
  yarn_item_id: string | null;
  dye_type: "dyed" | "grey";
  color_name?: string | null;
  uom_id: string | null;
  value: number | null;
  twisted_yarn?: string | null;
};
export type IwoYdCombinationLike = {
  item_id: string | null;
  combo?: string | null;
  yd_combo_name?: string | null;
  colors: readonly { sno: number; dyeing_loss_pct: number | null }[];
};

/** Is this Yarn Dyed row worth STORING — and so worth COUNTING? A blank row
 *  the grid opened says nothing, and its address is not content (the order
 *  action's `ydRepeatFilled` / `ydCombinationFilled`, same tests). The save
 *  stores only these, and `iwoYarnShades` counts only these, because a blank
 *  repeat still takes a stripe POSITION: counting it in the preview and not in
 *  the save would pair every later colour's loss with the wrong stripe. */
export const iwoYdRepeatFilled = (r: {
  yarn_item_id: string | null;
  color_name?: string | null;
  value: number | null;
  twisted_yarn?: string | null;
}) => !!(r.yarn_item_id || (r.color_name ?? "").trim() || r.value != null || (r.twisted_yarn ?? "").trim());
export const iwoYdCombinationFilled = (c: { combo?: string | null; yd_combo_name?: string | null }) =>
  !!((c.combo ?? "").trim() || (c.yd_combo_name ?? "").trim());

/**
 * THE DYED SHADES OF A FOR = FABRIC BOM (0599) — `yarnPurchase`'s last
 * argument, built from Details ▸ Yarn Dyed Details.
 *
 * `yarnPurchase`'s own header enumerates its callers and says a new one MUST
 * pass the shades, or a document that has them under-buys by every shade's dye
 * loss, silently. The IWO is that new caller, twice — the screen's preview and
 * the action's save — so both call THIS, never `yarnShadesFrom` directly, and
 * cannot build the shades two ways.
 *
 * ONE SET PER FABRIC: an IWO has no YD Part (0596 is the order's), so a
 * fabric's repeats are one stripe arrangement. A combination's `combo` is the
 * fabric line's Colour — the bucket `iwoFabricGross` makes.
 */
export function iwoYarnShades(
  repeats: readonly IwoYdRepeatLike[],
  combinations: readonly IwoYdCombinationLike[],
  compositions: ReadonlyMap<string, FabricComposition>,
): YarnShade[] {
  const kept = repeats.filter(iwoYdRepeatFilled);
  const fabricIds = [...new Set(kept.map((r) => r.item_id).filter((v): v is string => !!v))];
  return fabricIds.flatMap((fabricId) =>
    yarnShadesFrom(
      fabricId,
      kept
        .filter((r) => r.item_id === fabricId)
        .map((r) => ({
          key: `${fabricId}:${r.sno}`,
          sno: r.sno,
          yarn_item_id: r.yarn_item_id,
          dye_type: r.dye_type,
          color_name: r.color_name ?? "",
          uom_id: r.uom_id,
          value: r.value,
          twisted_yarn: r.twisted_yarn ?? "",
        })),
      compositions.get(fabricId) ?? null,
      combinations
        .filter((c) => c.item_id === fabricId && iwoYdCombinationFilled(c))
        .map((c) => ({
          combo: comboKey(c.combo ?? null) || null,
          colors: c.colors.map((x) => ({ sno: x.sno, dyeing_loss_pct: x.dyeing_loss_pct ?? 0 })),
        })),
    ),
  );
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
      /* 0613 — resolved per bucket by `stagesForGroup`; see the file header. */
      color_losses: p.color_losses ?? null,
      stage_id: p.stage_id,
      process_id: p.process_id,
      is_knitting: kind?.is_knitting ?? false,
      is_dyeing: kind?.is_dyeing ?? false,
    });
    out.set(p.item_id, list);
  }
  return out;
}

/** How a DYED yarn gets its colour (0592). */
export type IwoColourBy = "dyed_purchase" | "yarn_dyeing";

export const IWO_COLOUR_BY_OPTIONS: readonly { value: IwoColourBy; label: string }[] = [
  { value: "dyed_purchase", label: "Dyed Purchase" },
  { value: "yarn_dyeing", label: "Yarn Dyeing" },
];

/** One shade of a DYED yarn: a Yarn Colour panel name and the KGS planned in it. */
export type IwoYarnShade = { color_name: string; planned_kgs: number | null };

export type IwoYarnModeAnswer = {
  qty: number;
  uom_id: string | null;
  byCombo: YarnComboWeight[];
  /** Dyed Purchase only — each shade's own rounded purchase, keyed by
   *  `comboKey(color_name)`. Absent on GREY and on Yarn Dyeing, where the
   *  purchase is ONE grey lot. */
  shadeQty?: Record<string, number>;
};

/**
 * FOR = YARN (step 4, screenshot 2937): the yarn is PICKED and WEIGHED, not
 * derived from a cloth, so there is no fabric, no blend and no fabric route.
 * The planned weight goes through the yarn's OWN stages only — the same
 * `comboUplift` rule (divide by 1 − L, compounded) and the same round-UP
 * `yarnPurchase` applies, so a Yarn IWO and a Fabric IWO gross a 10% dyeing
 * loss identically.
 *
 * ## THREE SHAPES (client audio, 2026-09-19; 0592)
 *
 *   - **GREY** (`colourBy` null, no shades) — one uncoloured bucket, every
 *     stage applies. The pre-0592 answer, unchanged.
 *   - **DYED · Yarn Dyeing** — ONE BUCKET PER SHADE, each grossed by the steps
 *     that cover it — since 0613 that is ONE dyeing step For every shade,
 *     carrying each shade's own loss (`color_losses`), where 0592 wanted one
 *     step per shade; a stored step still scoped to a shade keeps working. The
 *     purchase is the grey lot: Σ shade gross, ROUNDED ONCE — the order rule
 *     ("grey yarn one lot"), since rounding each shade up and adding would buy
 *     a few grams per shade more than the dye house needs.
 *   - **DYED · Dyed Purchase** — the same buckets, but each shade IS a
 *     purchase, so each is rounded up on its own and the yarn's total is their
 *     sum; `shadeQty` carries them for the shade rows.
 *
 * WHY BUCKETS PER SHADE IS THE WHOLE TRICK: `stageProcessQty` already charges a
 * colour-scoped step on the bucket it names, and the Yarn Process grid's For
 * list is `byCombo`'s names — so per-shade dyeing needs nothing new in the
 * order engine, and a step For NAVY stops reading "this BOM needs no NAVY".
 *
 * Returns the order engine's success shape so `stageProcessQty` answers each
 * stage's quantity exactly as it does on an order.
 */
export function iwoYarnModePurchase(
  plannedKgs: number | null,
  ownStages: readonly {
    combo?: string | null;
    loss_pct: number | null;
    /** 0613 — shade → loss % of a COLOR WISE step. Carried, never read here. */
    color_losses?: Readonly<Record<string, number>> | null;
  }[],
  kgUomId: string | null,
  decimals: number | null,
  yarnName: string,
  dyed: { colourBy: IwoColourBy | null; shades: readonly IwoYarnShade[] } | null = null,
): IwoYarnModeAnswer | Refusal {
  if (!kgUomId) return { refused: "The UOM master has no active KGS row, so no yarn weight can be stated." };
  const precision = uomPrecision(decimals);

  if (!dyed) {
    if (plannedKgs == null || !(plannedKgs > 0)) {
      return { refused: `Enter the Planned Weight for ${yarnName} on Yarn Lines.` };
    }
    const factor = comboUplift(
      ownStages.map((s) => ({ combo: null, loss_pct: s.loss_pct, color_losses: s.color_losses ?? null })),
      "",
      [],
    );
    if (isRefusal(factor)) return factor;
    const gross = ceilToPrecision(plannedKgs * factor, precision);
    return { qty: gross, uom_id: kgUomId, byCombo: [{ combo: "", net: plannedKgs, gross }] };
  }

  if (!dyed.colourBy) return { refused: `Choose how ${yarnName} is coloured (Colour by) on Yarn Lines.` };
  if (dyed.shades.length === 0) return { refused: `Add the shades of ${yarnName} on Yarn Lines.` };

  /* Each shade is grossed on its OWN line of a COLOR WISE step's map (0613):
     `comboUplift(steps, key)` resolves `color_losses[key]` — the shade's figure,
     or the step's flat loss when the shade is not listed. */
  const steps = ownStages.map((s) => ({ combo: s.combo ?? null, loss_pct: s.loss_pct, color_losses: s.color_losses ?? null }));
  const byCombo: YarnComboWeight[] = [];
  const shadeQty: Record<string, number> = {};
  let rawTotal = 0;
  for (const sh of dyed.shades) {
    const key = comboKey(sh.color_name);
    if (!key) return { refused: `A shade of ${yarnName} names no colour.` };
    if (sh.planned_kgs == null || !(sh.planned_kgs > 0)) {
      return { refused: `Enter the KGS for ${key} of ${yarnName}.` };
    }
    const factor = comboUplift(steps, key, []);
    if (isRefusal(factor)) return factor;
    const raw = sh.planned_kgs * factor;
    if (dyed.colourBy === "dyed_purchase") {
      const bought = ceilToPrecision(raw, precision);
      shadeQty[key] = bought;
      byCombo.push({ combo: key, net: sh.planned_kgs, gross: bought });
    } else {
      byCombo.push({ combo: key, net: sh.planned_kgs, gross: raw });
    }
    rawTotal += raw;
  }
  if (dyed.colourBy === "dyed_purchase") {
    const qty = Number(Object.values(shadeQty).reduce((a, b) => a + b, 0).toFixed(6));
    return { qty, uom_id: kgUomId, byCombo, shadeQty };
  }
  return { qty: ceilToPrecision(rawTotal, precision), uom_id: kgUomId, byCombo };
}
