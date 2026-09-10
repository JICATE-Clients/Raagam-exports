import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * activity_id -> employee_id, from the given customer's most recently
 * created NON-DRAFT amendment (`garment_order_amendments` has no separate
 * "cancelled" status — only `is_draft`; that is the closest equivalent this
 * schema has to "most recent non-cancelled order").
 *
 * ONE lookup, no further fallback if that order named no owners and no
 * fallback to a different customer's order — matching this app's own
 * "empty-and-explain, never silent-fallback" rule (nominated vendors,
 * customer approval defaults, and every other scoped list in this codebase).
 * A brand-new customer with no prior order simply gets nothing to top up;
 * the merchandiser fills every row by hand, same as today.
 */
export async function getDefaultTaskOwners(
  customerId: string | null,
): Promise<Record<string, string>> {
  if (!customerId) return {};
  const s = await createClient();

  const { data: lastOrder, error: orderErr } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("customer_id", customerId)
    .eq("is_draft", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderErr) throw orderErr;
  if (!lastOrder) return {};

  const { data: rows, error: rowsErr } = await s
    .from("garment_order_amendment_ta_activities")
    .select("activity_id, assigned_staff_id")
    .eq("amendment_id", lastOrder.id)
    .not("assigned_staff_id", "is", null);
  if (rowsErr) throw rowsErr;

  const out: Record<string, string> = {};
  for (const r of rows ?? []) {
    if (r.activity_id && r.assigned_staff_id) out[r.activity_id] = r.assigned_staff_id;
  }
  return out;
}
