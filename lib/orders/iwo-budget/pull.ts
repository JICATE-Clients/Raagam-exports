/**
 * IWO Budget — what a work order's BOM puts on its budget (0594; client audio
 * 2026-09-19: "completed IWO BOMs auto-populate into the Budget under the
 * respective Yarn, Fabric or Accessories purchase / process tabs").
 *
 * PURE. The service reads the stored BOM and hands it here; no database, so
 * `scripts/check-iwo-budget.mts` can reach every clause. The ORDER budget's
 * pull (`lib/orders/budget/service.ts`) is the model, source by source, and
 * where it reads a figure the BOM's own save stored, so does this — a budget
 * line is never a second computation of a number the BOM already holds.
 *
 * ## SOURCE BY SOURCE
 *
 *   - **yarn** — `iwo_fabric_bom_yarns.purchase_qty`, the server-computed buy.
 *     A DYED Yarn IWO line bought by **Dyed Purchase** is one line PER SHADE
 *     (each shade is its own purchase, 0592, `combo` = the shade); every other
 *     yarn is one line. Stage = the line's own (GREY / DYED) on a Yarn IWO; a
 *     Fabric IWO buys its yarn GREY (the order pull's rule).
 *   - **yarn_process** — each step's stored `process_qty`, per shade where the
 *     step is For one. One line per (yarn, process, shade): two steps of one
 *     process on one lot are one charge. A DYEING step on a Yarn-Dyeing line
 *     that is For EVERY shade (0613's shape — one step, a loss per shade in
 *     `color_losses`) is SPLIT into one line per shade here, so the budget
 *     still carries one dyeing line (and one rate) per shade, which is what
 *     0592's one-step-per-shade rule existed to give it. See `splitDyeing`.
 *   - **fabric_process** — NOT STORED on an IWO (the order reads it from its
 *     requirement report), so computed here the report's way: the fabric's Req
 *     Wt through its route, each step's weight = net × that step's
 *     `factorAfter` (`comboUpliftBreakdown`) — exactly `toOrderedWt` in
 *     `reports.ts`, which the order Budget pulls. One line per (process,
 *     fabric), `basis` "fabric".
 *   - **material** — `iwo_material_bom_items.required_qty` in the consumption
 *     unit, with the BOM's FOC flag (the order pull's rule).
 *   - **material_process** — Σ that item's `required_qty`, per process.
 *
 * No fabric PURCHASE source: an IWO fabric is always knitted from its yarn.
 *
 * ## A REFUSED FIGURE IS SKIPPED AND SAID, NEVER PULLED AS ZERO
 *
 * A zero on a budget reads as "this is free". Every figure the BOM could not
 * state (its `refusal_reason`) is left out and listed in `skipped` with the
 * BOM's own sentence, so the operator is told what is missing.
 */

import { comboUpliftBreakdown, isRefusal, stageProcessQty } from "@/lib/orders/fabric-bom/yarn-process";
import { iwoFabricGross, iwoRoutesByFabric, iwoYarnModePurchase } from "@/lib/orders/iwo-fabric-bom/yarn";

export type IwoBudgetSource = "yarn" | "yarn_process" | "fabric_process" | "material" | "material_process" | "expense";

export const IWO_BUDGET_SOURCES: readonly IwoBudgetSource[] = [
  "yarn",
  "yarn_process",
  "fabric_process",
  "material",
  "material_process",
  "expense",
];

/** One line as the pull produces it — `from_bom`, no rate (the operator types it). */
export type IwoPulledLine = {
  source: IwoBudgetSource;
  item_id: string | null;
  process_id: string | null;
  combo: string | null;
  basis: "process" | "fabric" | "color" | null;
  qty: number;
  uom_id: string | null;
  stage_id: string | null;
  specification: string | null;
  is_foc: boolean;
};

// ---- what the service reads -------------------------------------------------

export type IwoPullYarn = {
  item_id: string;
  purchase_qty: number | null;
  uom_id: string | null;
  refusal_reason: string | null;
  buy_stage_id: string | null;
  colour_by: "dyed_purchase" | "yarn_dyeing" | null;
  /** `planned_kgs` (0613) is what `splitDyeing` re-runs the shade buckets from. */
  shades: { color_name: string; planned_kgs?: number | null; purchase_qty: number | null }[];
  stages: {
    sno: number;
    stage_id: string | null;
    process_id: string | null;
    combo: string | null;
    /** `loss_pct` + `color_losses` (0613): the step as the engine grosses it,
     *  for `splitDyeing`. Optional so older vectors stay well-formed. */
    loss_pct?: number | null;
    color_losses?: Record<string, number> | null;
    process_qty: number | null;
    uom_id: string | null;
    refusal_reason: string | null;
  }[];
};

export type IwoPullInput = {
  iwoFor: "yarn" | "fabric" | "accessories";
  fabricBom: {
    is_draft: boolean;
    yarns: IwoPullYarn[];
    lines: { item_id: string; req_kgs: number | null }[];
    processes: { item_id: string; sno: number; stage_id: string | null; process_id: string | null; loss_pct: number | null }[];
  } | null;
  materialBom: {
    is_draft: boolean;
    items: {
      item_id: string;
      /** The item's colour (`item_color_id`'s name) — one accessory in two
       *  colours is two lines, and this is what tells them apart. */
      color_name: string | null;
      required_qty: number | null;
      consumption_uom_id: string | null;
      specification: string | null;
      is_foc: boolean;
      refusal_reason: string | null;
    }[];
    processes: { item_id: string; process_id: string }[];
  } | null;
  kgUomId: string | null;
  /** The `yarn_stage` row a grey purchase is stamped with (`stageRank` 0). */
  greyYarnStageId: string | null;
  /** The process master's kind flags, for every process a fabric route or a
   *  yarn step names. `is_cloth_purchase` marks a step that BUYS the material
   *  (FABRIC PURCHASE, DYED FABRIC PURCHASE, YARN PURCHASE — 0583 · 0612). */
  processKinds: ReadonlyMap<string, { is_knitting: boolean; is_dyeing: boolean; is_cloth_purchase: boolean }>;
  name: (itemId: string) => string;
};

export type IwoPullResult = { lines: IwoPulledLine[]; skipped: string[] } | { refused: string };

/** Quantities are stored numeric(16,4); round once, here, so a refresh that
 *  compares stored and fresh never reads noise as a change. */
const q4 = (n: number) => Math.round(n * 1e4) / 1e4;
const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase() || null;

export function pullIwoLines(input: IwoPullInput): IwoPullResult {
  const lines: IwoPulledLine[] = [];
  const skipped: string[] = [];
  const base = { process_id: null, combo: null, basis: null, specification: null, is_foc: false } as const;

  if (input.iwoFor === "accessories") {
    const bom = input.materialBom;
    if (!bom) return { refused: "This work order has no Material BOM yet — raise it first." };
    if (bom.is_draft) return { refused: "The Material BOM is a draft — save it (not as a draft) before budgeting it." };

    const reqByItem = new Map<string, { qty: number; uom: string | null; broken: boolean }>();
    for (const it of bom.items) {
      if (it.required_qty == null) {
        skipped.push(`${input.name(it.item_id)}: ${it.refusal_reason ?? "no required quantity on the Material BOM"}`);
        reqByItem.set(it.item_id, { qty: 0, uom: it.consumption_uom_id, broken: true });
        continue;
      }
      lines.push({
        ...base,
        source: "material",
        item_id: it.item_id,
        combo: up(it.color_name),
        qty: q4(Number(it.required_qty)),
        uom_id: it.consumption_uom_id,
        stage_id: null,
        specification: it.specification,
        is_foc: it.is_foc,
      });
      const held = reqByItem.get(it.item_id);
      reqByItem.set(it.item_id, {
        qty: (held?.qty ?? 0) + Number(it.required_qty),
        uom: held?.uom ?? it.consumption_uom_id,
        broken: held?.broken ?? false,
      });
    }
    const seen = new Set<string>();
    for (const pr of bom.processes) {
      const key = `${pr.item_id}|${pr.process_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const req = reqByItem.get(pr.item_id);
      // A process on an item whose quantity is unknown has nothing to charge on.
      if (!req || req.broken) continue;
      lines.push({
        ...base,
        source: "material_process",
        item_id: pr.item_id,
        process_id: pr.process_id,
        qty: q4(req.qty),
        uom_id: req.uom,
        stage_id: null,
      });
    }
    return { lines, skipped };
  }

  const bom = input.fabricBom;
  if (!bom) return { refused: "This work order has no Fabric BOM yet — raise it first." };
  if (bom.is_draft) return { refused: "The Fabric BOM is a draft — save it (not as a draft) before budgeting it." };

  // ---- yarn purchase + yarn process ----
  for (const y of bom.yarns) {
    const yarnName = input.name(y.item_id);
    if (y.purchase_qty == null) {
      skipped.push(`${yarnName}: ${y.refusal_reason ?? "no purchase weight on the Fabric BOM"}`);
    } else if (input.iwoFor === "yarn" && y.colour_by === "dyed_purchase" && y.shades.length) {
      for (const sh of y.shades) {
        if (sh.purchase_qty == null) {
          skipped.push(`${yarnName} ${sh.color_name}: no purchase weight on the Fabric BOM`);
          continue;
        }
        lines.push({
          ...base,
          source: "yarn",
          item_id: y.item_id,
          combo: up(sh.color_name),
          qty: q4(Number(sh.purchase_qty)),
          uom_id: y.uom_id,
          stage_id: y.buy_stage_id,
        });
      }
    } else {
      lines.push({
        ...base,
        source: "yarn",
        item_id: y.item_id,
        qty: q4(Number(y.purchase_qty)),
        uom_id: y.uom_id,
        // A Yarn IWO line states its own Stage — EXCEPT Yarn Dyeing, whose one
        // purchase is the GREY lot that is dyed afterwards (0592); the colour
        // is costed on its dyeing lines. A Fabric IWO's yarn is bought grey.
        stage_id:
          input.iwoFor === "yarn" && y.colour_by !== "yarn_dyeing"
            ? (y.buy_stage_id ?? input.greyYarnStageId)
            : input.greyYarnStageId,
      });
    }

    /**
     * ONE DYEING LINE PER SHADE, STILL (0613). Under 0592 a Yarn-Dyeing line's
     * dyeing steps each named a shade, and the loop below made a line per
     * (process, shade) from the stored `combo`. 0613 gave the IWO the Fabric
     * BOM's shape — ONE dyeing step For every shade, its per-shade losses in
     * `color_losses` — so that step's stored `process_qty` is Σ shades and its
     * `combo` is null. Splitting it here is what keeps the budget's grain: the
     * shade's dyeing quantity IS a number the BOM computed (its bucket's gross,
     * `byCombo`, the figure `stageProcessQty` summed into `process_qty`) — it
     * is just not stored per shade, so it is re-run through the SAME pure
     * function the save ran, `iwoYarnModePurchase`, over the stored shades and
     * stored steps. Σ of the split = the stored `process_qty`, to the rounding.
     *
     * Only a DYEING step, only on a Yarn-Dyeing line, only when For every
     * shade: a winding step For every shade stays one line, as it always was
     * (a change nobody asked for), and a step still scoped to one shade (a
     * 0592 row) already is that shade's line. If the re-run refuses — it
     * cannot on a BOM that saved a quantity, but a defensive path is cheap —
     * the step falls back to the one summed line rather than to nothing.
     */
    const dyeingBuckets =
      input.iwoFor === "yarn" && y.colour_by === "yarn_dyeing" && y.shades.length
        ? (() => {
            const w = iwoYarnModePurchase(
              null,
              y.stages.map((st) => ({ combo: st.combo, loss_pct: st.loss_pct ?? null, color_losses: st.color_losses ?? null })),
              input.kgUomId,
              null,
              yarnName,
              {
                colourBy: "yarn_dyeing",
                shades: y.shades.map((sh) => ({ color_name: sh.color_name, planned_kgs: sh.planned_kgs ?? null })),
              },
            );
            return isRefusal(w) ? null : w.byCombo;
          })()
        : null;
    const splitDyeing = (st: (typeof y.stages)[number]): { combo: string; qty: number }[] | null => {
      if (!dyeingBuckets || up(st.combo) || !input.processKinds.get(st.process_id as string)?.is_dyeing) return null;
      return dyeingBuckets.map((b) => ({ combo: b.combo, qty: stageProcessQty(b.combo, dyeingBuckets) }));
    };

    // One charge per (process, shade) on this yarn — steps sorted by sno, so the
    // first step's stage names the line.
    const byKey = new Map<string, IwoPulledLine>();
    const charge = (st: (typeof y.stages)[number], combo: string | null, qty: number) => {
      const key = `${st.process_id}|${combo ?? ""}`;
      const held = byKey.get(key);
      if (held) held.qty = q4(held.qty + qty);
      else {
        byKey.set(key, {
          ...base,
          source: "yarn_process",
          item_id: y.item_id,
          process_id: st.process_id,
          combo,
          basis: combo ? "color" : "process",
          qty: q4(qty),
          uom_id: st.uom_id,
          stage_id: st.stage_id,
        });
      }
    };
    for (const st of [...y.stages].sort((a, b) => a.sno - b.sno)) {
      if (!st.process_id) continue;
      // A PURCHASE IS NOT A PROCESS (client 2026-09-21) — the order Budget's
      // rule (`pullCostLines`): the material is costed once, on Purchase
      // Rates; a YARN PURCHASE step (the GREIGE base, 0611) is that same
      // weight again, so it never becomes a `yarn_process` line.
      if (input.processKinds.get(st.process_id)?.is_cloth_purchase) continue;
      if (st.process_qty == null) {
        skipped.push(`${yarnName}: a Yarn Process step — ${st.refusal_reason ?? "no weight on the Fabric BOM"}`);
        continue;
      }
      const perShade = splitDyeing(st);
      if (perShade) for (const sh of perShade) charge(st, sh.combo, sh.qty);
      else charge(st, up(st.combo), Number(st.process_qty));
    }
    lines.push(...byKey.values());
  }

  // ---- fabric process (Fabric IWO) ----
  if (input.iwoFor === "fabric") {
    const gross = iwoFabricGross(bom.lines, input.kgUomId, input.name);
    const routes = iwoRoutesByFabric(bom.processes.filter((p) => p.process_id), input.processKinds);
    const byKey = new Map<string, IwoPulledLine>();
    for (const g of gross) {
      if (g.gross == null) {
        skipped.push(`${input.name(g.fabric_id)}: ${g.refusal ?? "no Req Wt"}`);
        continue;
      }
      const route = routes.get(g.fabric_id) ?? [];
      const ladder = comboUpliftBreakdown(route, "", [], "yarn_knit");
      if (isRefusal(ladder)) {
        skipped.push(`${input.name(g.fabric_id)}: ${ladder.refused}`);
        continue;
      }
      for (const step of ladder.steps) {
        if (!step.process_id) continue;
        // A PURCHASE IS NOT A PROCESS (client 2026-09-21): a route that opens
        // with FABRIC PURCHASE keeps the step (its loss grosses the buy), but
        // the cloth is bought, not processed — no `fabric_process` line.
        if (input.processKinds.get(step.process_id)?.is_cloth_purchase) continue;
        // The order report's `toOrderedWt` (reports.ts), the same arithmetic —
        // so an IWO and an order cost one step of one route alike.
        const wt = Number((g.gross * step.factorAfter).toFixed(6));
        const key = `${step.process_id}|${g.fabric_id}`;
        const held = byKey.get(key);
        if (held) held.qty = q4(held.qty + wt);
        else {
          byKey.set(key, {
            ...base,
            source: "fabric_process",
            item_id: g.fabric_id,
            process_id: step.process_id,
            basis: "fabric",
            qty: q4(wt),
            uom_id: input.kgUomId,
            stage_id: step.stage_id,
          });
        }
      }
    }
    lines.push(...byKey.values());
  }

  return { lines, skipped };
}

/** The key a pulled line is "the same line" by — the order Budget's
 *  `pulledLineKey` minus its garment axes, with text case-folded (a stored
 *  shade is in capitals). */
export function iwoPulledKey(l: {
  source: string;
  item_id: string | null;
  process_id?: string | null;
  combo?: string | null;
  basis?: string | null;
}): string {
  return [l.source, l.item_id, l.process_id, up(l.combo), l.basis].map((v) => v ?? "").join("|");
}
