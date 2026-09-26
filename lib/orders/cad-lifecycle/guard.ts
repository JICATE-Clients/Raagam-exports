import "server-only";
import { createClient } from "@/lib/supabase/server";

/* THE FABRIC BOM GUARD THAT STOOD HERE IS GONE (0646, user 2026-09-26): a
 * Fabric BOM is created whatever the pattern state. What remains is the
 * report stamp below, which blocks nothing. */

/**
 * Is the order's CAD still pending? For the report stamp.
 *
 * PENDING = SOME STYLE'S PATTERN IS NOT READY — the same test as the gate
 * above (`cad_order_pattern_ready`, 0641). It used to be "every style
 * APPROVED by the buyer" (`cad_order_ready`), but there is no Send CAD step
 * any more (user 2026-09-25: assigning the pattern maker IS the send, Pattern
 * Status Ready IS the receive), so nothing reaches Approved and every report
 * would have been stamped for good.
 */
export async function cadOrderPending(garmentOrderId: string): Promise<boolean> {
  const s = await createClient();
  const { data, error } = await s.rpc("cad_order_pattern_ready", { p_order: garmentOrderId });
  if (error) {
    console.error("[cad-guard] reading cad_order_pattern_ready:", error.message);
    // Unknown is shown as pending: the stamp only says "treat as estimates",
    // and leaving it off a report whose CAD may be unapproved is the worse error.
    return true;
  }
  return data !== true;
}
