import "server-only";
import { createClient } from "@/lib/supabase/server";
import { cadOrderPending } from "./guard";

/**
 * The CAD stamp's flag for a report that knows its Fabric BOM but not its
 * order (the Fabric Requirement Sheet). Read LIVE at the page, so a frozen
 * V_final copy is stamped by today's CAD state, never by the freeze's.
 * Unknown (a failed read) is shown as pending — see `cadOrderPending`.
 */
export async function cadPendingForFabricBom(bomId: string): Promise<boolean> {
  const s = await createClient();
  const { data, error } = await s.from("order_fabric_boms").select("garment_order_id").eq("id", bomId).maybeSingle();
  if (error || !data) {
    if (error) console.error("[cad-stamp] reading the Fabric BOM's order:", error.message);
    return true;
  }
  return cadOrderPending((data as { garment_order_id: string }).garment_order_id);
}
