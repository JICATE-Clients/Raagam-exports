import "server-only";
import { createClient } from "@/lib/supabase/server";
import { V_FINAL_SOURCES, type VFinalSource } from "@/lib/orders/order-reports";
import { getGarmentOrderSheet } from "@/lib/orders/gos/service";
import { getRequirementSheet } from "@/lib/orders/requirement/service";
import {
  currentFabricBom,
  getFabricRequirementSheet,
  isFabricSheetRefusal,
} from "@/lib/orders/fabric-requirement/service";
import { fabricBomEntryRegister, yarnFabricRequirementReport } from "@/lib/orders/fabric-bom/reports";
import {
  currentMaterialBom,
  materialBomRequirementReport,
} from "@/lib/orders/material-bom-amendment/requirement-report";
import { getCuttingChart } from "@/lib/orders/cutting-chart/service";
import { getOrderBudgetReport } from "@/lib/orders/budget/report";

/**
 * V_FINAL — THE LATEST APPROVED VERSION, FOR EVERY OPERATIONAL REPORT
 * (doc/order/amenment update.md §4B, 0619).
 *
 * "All operational and production reports automatically fetch and display data
 * from the latest approved version (V_final)." While an order is AMENDING its
 * live rows are the merchandiser's work in progress, and a Fabric BOM Entry
 * Register printed from them would send an unapproved plan to the knitting
 * floor.
 *
 * ## THE REPORT'S OWN OUTPUT, FROZEN — NOT A SECOND QUERY ENGINE
 *
 * The loaders read live tables through nested PostgREST embeds; re-pointing
 * them at the V0 snapshot rows would mean re-implementing those embeds over
 * jsonb — a second answer to every report, free to disagree with the first.
 * Instead each loader is run ONCE, at raise, while the live rows ARE the
 * approved version (nothing can have been edited yet: the entry is seconds
 * old and the RE was locked until it existed), and its output is stored
 * verbatim in `order_amendment_report_snapshots`. Same loader, same figures.
 *
 * After the entry closes there is nothing to serve: APPROVED makes the live
 * rows the new approved version, REJECTED / ABANDONED revert them to V0.
 *
 * ## THREE STATES A REPORT CAN BE IN
 *
 *   - `live`    — the order is not amending; the report reads live rows.
 *   - `frozen`  — amending, and V_final was captured: the report prints it.
 *   - `missing` — amending, and V_final was NOT captured (an entry raised
 *                 before 0619, or a capture that failed). The report prints
 *                 live rows under a banner saying they are UNAPPROVED — never
 *                 silently, which would be the one failure this file exists to
 *                 prevent.
 */

export type VFinalPayloads = {
  gos: Awaited<ReturnType<typeof getGarmentOrderSheet>>;
  "requirement-sheet": Awaited<ReturnType<typeof getRequirementSheet>>;
  "fabric-requirement-sheet": Awaited<ReturnType<typeof getFabricRequirementSheet>>;
  "fabric-bom-reports":
    | { refused: string }
    | {
        bomId: string;
        register: Awaited<ReturnType<typeof fabricBomEntryRegister>>;
        requirement: Awaited<ReturnType<typeof yarnFabricRequirementReport>>;
      };
  "material-bom-requirement":
    | { refused: string }
    | { bomId: string; requirement: Awaited<ReturnType<typeof materialBomRequirementReport>> };
  "cutting-chart": Awaited<ReturnType<typeof getCuttingChart>>;
  "order-budget": Awaited<ReturnType<typeof getOrderBudgetReport>>;
};

/** Run one loader, as the report route would. */
async function load<S extends VFinalSource>(source: S, salesOrderId: string): Promise<VFinalPayloads[S]> {
  switch (source) {
    case "gos":
      return (await getGarmentOrderSheet(salesOrderId)) as VFinalPayloads[S];
    case "requirement-sheet":
      return (await getRequirementSheet(salesOrderId)) as VFinalPayloads[S];
    case "fabric-requirement-sheet":
      return (await getFabricRequirementSheet(salesOrderId)) as VFinalPayloads[S];
    case "cutting-chart":
      return (await getCuttingChart(salesOrderId)) as VFinalPayloads[S];
    case "order-budget":
      return (await getOrderBudgetReport(salesOrderId)) as VFinalPayloads[S];
    case "fabric-bom-reports": {
      const current = await currentFabricBom(salesOrderId);
      if (isFabricSheetRefusal(current)) return { refused: current.refused } as VFinalPayloads[S];
      const [register, requirement] = await Promise.all([
        fabricBomEntryRegister(current.bom.id),
        yarnFabricRequirementReport(current.bom.id),
      ]);
      return { bomId: current.bom.id, register, requirement } as VFinalPayloads[S];
    }
    default: {
      const current = await currentMaterialBom(salesOrderId);
      if ("refused" in current) return { refused: current.refused } as VFinalPayloads[S];
      return {
        bomId: current.id,
        requirement: await materialBomRequirementReport(current.id),
      } as VFinalPayloads[S];
    }
  }
}

/**
 * A payload survives jsonb only if it is plain data. A Map, a Set, a Date or a
 * class instance would come back as `{}` or a string and the frozen report
 * would silently disagree with the live one — so it is REFUSED here, loudly,
 * rather than stored wrong.
 */
function plainDataProblem(v: unknown, path = "payload"): string | null {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === undefined) return null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = plainDataProblem(v[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return `${path} is a ${proto?.constructor?.name ?? "non-plain object"}`;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const p = plainDataProblem(x, `${path}.${k}`);
      if (p) return p;
    }
    return null;
  }
  return `${path} is a ${typeof v}`;
}

/**
 * CAPTURE V_final for a just-raised entry — every source, each on its own, so
 * one report that cannot be worked out does not cost the others. Returns the
 * sources that could not be captured (with why); the caller reports them, and
 * each of those reports reads `missing` rather than lying.
 */
export async function captureVFinal(entryId: string, salesOrderId: string): Promise<{ source: VFinalSource; error: string }[]> {
  const s = await createClient();
  const failed: { source: VFinalSource; error: string }[] = [];
  const rows: { entry_id: string; report_key: string; payload: unknown }[] = [];
  for (const source of V_FINAL_SOURCES) {
    try {
      const payload = await load(source, salesOrderId);
      const problem = plainDataProblem(payload);
      if (problem) {
        failed.push({ source, error: `not plain data (${problem})` });
        continue;
      }
      rows.push({ entry_id: entryId, report_key: source, payload: JSON.parse(JSON.stringify(payload)) });
    } catch (e) {
      failed.push({ source, error: e instanceof Error ? e.message : "could not be worked out" });
    }
  }
  if (rows.length) {
    const { error } = await s.from("order_amendment_report_snapshots").insert(rows);
    if (error) return V_FINAL_SOURCES.map((source) => ({ source, error: error.message }));
  }
  return failed;
}

export type VFinalState<S extends VFinalSource> =
  | { state: "live" }
  | {
      state: "frozen";
      entryId: string;
      entryNo: string | null;
      capturedAt: string;
      /** V_n — how many amendments of this order have been approved before. */
      version: number;
      payload: VFinalPayloads[S];
    }
  | { state: "missing"; entryId: string; entryNo: string | null; version: number };

/**
 * Which version a report on this order must print. `salesOrderId` is the RE
 * the report routes are keyed on; the lock is per RE (0576), so any document of
 * the RE reading `amending` puts every report of it on V_final.
 */
export async function vFinalFor<S extends VFinalSource>(source: S, salesOrderId: string): Promise<VFinalState<S>> {
  const s = await createClient();
  const { data: docs, error } = await s
    .from("garment_order_amendments")
    .select("id, re_amendment_id")
    .eq("sales_order_id", salesOrderId)
    .eq("re_status", "amending")
    .not("re_amendment_id", "is", null)
    .limit(1);
  /* A FAILED READ IS NOT "NOT AMENDING" — that would print the in-flight rows
     as if approved. It throws, and the report page's error boundary says so. */
  if (error) throw new Error(`Could not read whether this order is being amended: ${error.message}`);
  const doc = ((docs ?? []) as { id: string; re_amendment_id: string }[])[0];
  if (!doc) return { state: "live" };

  const [{ data: entry, error: eErr }, { data: snap, error: sErr }] = await Promise.all([
    s.from("order_budget_revisions").select("id, entry_no, garment_order_id").eq("id", doc.re_amendment_id).maybeSingle(),
    s
      .from("order_amendment_report_snapshots")
      .select("payload, captured_at")
      .eq("entry_id", doc.re_amendment_id)
      .eq("report_key", source)
      .maybeSingle(),
  ]);
  if (eErr) throw new Error(`Could not read the open amendment: ${eErr.message}`);
  if (sErr) throw new Error(`Could not read the approved version: ${sErr.message}`);
  const e = entry as { id: string; entry_no: string | null; garment_order_id: string | null } | null;

  let version = 0;
  if (e?.garment_order_id) {
    const { count } = await s
      .from("order_budget_revisions")
      .select("id", { count: "exact", head: true })
      .eq("garment_order_id", e.garment_order_id)
      .eq("outcome", "reapproved");
    version = count ?? 0;
  }

  const row = snap as { payload: unknown; captured_at: string } | null;
  if (!row) return { state: "missing", entryId: doc.re_amendment_id, entryNo: e?.entry_no ?? null, version };
  return {
    state: "frozen",
    entryId: doc.re_amendment_id,
    entryNo: e?.entry_no ?? null,
    capturedAt: row.captured_at,
    version,
    payload: row.payload as VFinalPayloads[S],
  };
}

/** The same question keyed on a BOM, for the editors' report sheets. */
export async function salesOrderOfBom(kind: "fabric" | "material", bomId: string): Promise<string | null> {
  const s = await createClient();
  const { data } = await s
    .from(kind === "fabric" ? "order_fabric_boms" : "material_bom_amendments")
    .select("garment_order_id")
    .eq("id", bomId)
    .maybeSingle();
  const orderId = (data as { garment_order_id: string | null } | null)?.garment_order_id;
  if (!orderId) return null;
  const { data: o } = await s.from("garment_order_amendments").select("sales_order_id").eq("id", orderId).maybeSingle();
  return (o as { sales_order_id: string | null } | null)?.sales_order_id ?? null;
}
