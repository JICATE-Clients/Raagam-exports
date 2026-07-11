"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, requireUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/orders/approve-amendments";

/**
 * Decide one or more Garment Order Amendments (step 11 "Approve Amendment").
 * Records the decision — status + who + when + optional reason — on the
 * amendment header. It does NOT mutate the live sales_orders (applying amended
 * values back to the order is a separate, later step). Only submitted
 * (is_draft = false) amendments can be decided. Reuses the 'orders' permission.
 */
export async function decideAmendment(
  ids: string[],
  decision: "approved" | "rejected",
  reason?: string,
): Promise<Result> {
  if (!(await can("orders", "edit"))) {
    return { ok: false, error: "Forbidden" };
  }

  if (!ids.length) {
    return { ok: false, error: "No amendments selected" };
  }

  if (decision === "rejected" && !reason?.trim()) {
    return { ok: false, error: "A reason is required to reject" };
  }

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("garment_order_amendments")
    .update({
      approval_status: decision,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      approval_reason: reason?.trim() || null,
    })
    .in("id", ids)
    .eq("is_draft", false);

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: decision === "approved" ? "garment_order_amendment.approved" : "garment_order_amendment.rejected",
    entityType: "garment_order_amendment",
    entityId: ids[0],
  });

  revalidatePath(LIST_PATH);
  revalidatePath("/orders/amendments");
  revalidatePath("/orders");
  return { ok: true };
}
