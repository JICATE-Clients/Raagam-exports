import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalQueueRow } from "./types";

/**
 * The approval queue: submitted (non-draft) Garment Order Amendments with the
 * legacy grid's columns + embedded lookups. Drafts are still being edited, so
 * only is_draft = false amendments are up for a decision.
 */
export async function getAmendmentApprovals(): Promise<ApprovalQueueRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("garment_order_amendments")
    .select(
      `id, code, amend_date, po_no, delivery_date, ship_mode, currency_code, pay_mode,
       reason_text, approval_status, approved_at, approval_reason,
       sales_order:sales_orders(id, order_number, ship_date, order_qty),
       buyer:buyers(id, code, name),
       ship_type:config_lookups!ship_type_id(name),
       approver:profiles!approved_by(id, full_name),
       creator:profiles!created_by(full_name)`,
    )
    .eq("is_draft", false)
    .order("amend_date", { ascending: false })
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as ApprovalQueueRow[];
}
