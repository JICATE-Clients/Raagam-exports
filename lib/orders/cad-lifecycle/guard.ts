import "server-only";
import { createClient } from "@/lib/supabase/server";
import { CAD_STATE_META, type CadState } from "./types";

/**
 * THE FABRIC BOM GUARD, read ahead of the write (doc/order/cad.md §7).
 *
 * The DATABASE is the guard — 0628's `trg_ofb_cad_guard` refuses the INSERT of
 * an order's Fabric BOM while any current style's latest CAD version is not
 * approved. This is the same question asked EARLY, so the operator is told when
 * they pick the order — not after typing the whole BOM and pressing Save.
 *
 * Same state function (`cad_style_states`), same sentence shape as the trigger.
 * A failed read answers null (no early refusal): the trigger still stands
 * behind it, so a failed read costs a late message, never a wrong write.
 */
export async function cadFabricBomProblem(garmentOrderId: string): Promise<string | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("cad_style_states", { p_order: garmentOrderId });
  if (error) {
    console.error("[cad-guard] reading cad_style_states:", error.message);
    return null;
  }
  const rows = (data ?? []) as { style_ref_no: string; state: CadState }[];
  if (rows.length === 0) {
    return "The CAD is not approved for every style of this order, so a Fabric BOM cannot be created yet — the order has no styles. Approve it on Orders ▸ CAD ▸ CAD Queue first.";
  }
  const open = rows.filter((r) => r.state !== "approved");
  if (open.length === 0) return null;
  return (
    "The CAD is not approved for every style of this order, so a Fabric BOM cannot be created yet — " +
    open.map((r) => `${r.style_ref_no} (${(CAD_STATE_META[r.state]?.label ?? r.state).toLowerCase()})`).join(", ") +
    ". Approve it on Orders ▸ CAD ▸ CAD Queue first."
  );
}

/** Is the order's CAD submitted (every current style approved)? For the report stamp. */
export async function cadOrderPending(garmentOrderId: string): Promise<boolean> {
  const s = await createClient();
  const { data, error } = await s.rpc("cad_order_ready", { p_order: garmentOrderId });
  if (error) {
    console.error("[cad-guard] reading cad_order_ready:", error.message);
    // Unknown is shown as pending: the stamp only says "treat as estimates",
    // and leaving it off a report whose CAD may be unapproved is the worse error.
    return true;
  }
  return data !== true;
}
