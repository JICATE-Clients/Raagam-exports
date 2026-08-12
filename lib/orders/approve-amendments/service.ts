import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
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
       customer:customers(id, code, name),
       ship_type:config_lookups!ship_type_id(code, name),
       approver:profiles!approved_by(id, full_name),
       created_by, created_at`,
    )
    .eq("is_draft", false)
    .order("amend_date", { ascending: false })
    .order("created_at", { ascending: false });

  // `creator:profiles!created_by(full_name)` stood here and always resolved to
  // null for a non-admin — `profiles_read_own` (0001_foundation.sql:150) hides
  // other users' profile rows. Resolved through the SECURITY DEFINER
  // `creator_names()` RPC instead (0383).
  return withCreators((data ?? []) as unknown as ApprovalQueueRow[]);
}
