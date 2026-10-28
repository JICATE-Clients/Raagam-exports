import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * A PO'S ITEM CLASSES — what decides which approver it goes to (0765).
 *
 * Every class on the PO (YARN, FABRIC, SEW, PACK …), not one: the run's flow is
 * the first whose classes include ANY of them, in priority order, so a Yarn +
 * Trims PO lands with the more senior approver (user 2026-10-28). Read from the
 * saved lines by `po_item_class_codes`, so both doors — Raise PO and the PO page's
 * Submit — route on the same answer.
 *
 * An empty list is a real answer (lines with no item class): no class flow
 * matches, and the catch-all takes it.
 */
export async function poItemClasses(poId: string): Promise<string[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("po_item_class_codes", { p_po: poId });
  if (error) {
    // Routing on a guess is worse than routing to the catch-all; say so in the log.
    console.error(`[po-routing] ${poId}: item classes not read — ${error.message}`);
    return [];
  }
  return Array.isArray(data) ? (data as string[]) : [];
}
