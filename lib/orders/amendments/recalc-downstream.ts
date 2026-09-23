import "server-only";
import { createClient } from "@/lib/supabase/server";
import { recalculateFabricBomDerived } from "@/lib/orders/fabric-bom/actions";
import { recalculateMaterialBomDerived } from "@/lib/orders/material-bom-amendment/actions";

/**
 * AUTOMATIC RECALCULATION OF AN AMENDED ORDER'S BOMs (doc/order/amenment
 * update.md §3.1, 0619): "updates existing rates, quantities, required weights
 * and total budget automatically across all locations".
 *
 * Runs both BOMs' DERIVED-ONLY recalculations — requirements, yarn purchase /
 * process weights, the header's basis stamp — from their stored authored rows
 * and the order's current production. Authored rows are never written, so
 * this is legal under a scope that keeps the BOM itself read-only. Called by
 * Order Entry's save (after an amended order's quantities or colourways move)
 * and by the Amendment Entry page's Recalculate button.
 *
 * NEVER FATAL TO THE CALLER'S SAVE: the order is already saved when this runs.
 * What could not be recalculated comes back as sentences for the operator,
 * and the budget's freshness gate still refuses a stale BOM at submit, so a
 * failure here is visible and blocks approval — it cannot slip through.
 */
export type DownstreamRecalc = {
  /** One line per BOM: "Fabric BOM recalculated — 24 requirement rows changed". */
  done: string[];
  /** "Manual Entry Needed: [Fabric BOM] -> …" and refusals, in the spec's shape. */
  manualEntries: string[];
};

export async function recalculateDownstream(garmentOrderId: string): Promise<DownstreamRecalc> {
  const s = await createClient();
  const [{ data: fab }, { data: mat }] = await Promise.all([
    s.from("order_fabric_boms").select("id").eq("garment_order_id", garmentOrderId).maybeSingle(),
    s
      .from("material_bom_amendments")
      .select("id")
      .eq("garment_order_id", garmentOrderId)
      .eq("is_draft", false)
      // THE LATEST — a lookup, not a listing, so newest first.
      .order("amendment_no", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const out: DownstreamRecalc = { done: [], manualEntries: [] };
  const jobs: [string, string | undefined, (id: string) => ReturnType<typeof recalculateFabricBomDerived>][] = [
    ["Fabric BOM", (fab as { id: string } | null)?.id, (id) => recalculateFabricBomDerived(id)],
    ["Material BOM", (mat as { id: string } | null)?.id, (id) => recalculateMaterialBomDerived(id)],
  ];
  for (const [label, id, run] of jobs) {
    if (!id) continue;
    const res = await run(id);
    if (!res.ok) {
      out.manualEntries.push(
        res.error.startsWith("Manual Entry Needed") ? res.error : `Manual Entry Needed: [${label}] -> ${res.error}`,
      );
      continue;
    }
    const n = res.changed.requirements + (res.changed.yarns ?? 0) + (res.changed.stages ?? 0);
    out.done.push(n === 0 ? `${label} already up to date` : `${label} recalculated (${n} figure${n === 1 ? "" : "s"} moved)`);
    out.manualEntries.push(...res.manualEntries.map((m) => m.message));
  }
  return out;
}
