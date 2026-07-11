"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { orderCancellationInput, type OrderCancellationInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/orders/cancellations";

/**
 * Cancel a garment order: log a reason-bearing cancellation record, then flip
 * the order's status to 'cancelled'. Reuses the 'orders' permission.
 */
export async function cancelOrder(
  payload: OrderCancellationInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = orderCancellationInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { order_id, customer_id, order_no, cancelled_date, remarks } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("order_cancellations")
    .insert({
      order_id,
      customer_id: customer_id ?? null,
      order_no: order_no || null,
      cancelled_date,
      remarks: remarks || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to cancel order" };
  }

  const { error: sErr } = await supabase
    .from("sales_orders")
    .update({ status: "cancelled" })
    .eq("id", order_id);

  if (sErr) {
    return { ok: false, error: sErr.message };
  }

  await writeAudit({
    action: "order.cancelled",
    entityType: "sales_order",
    entityId: order_id,
  });

  revalidatePath(LIST_PATH);
  revalidatePath("/orders");
  return { ok: true };
}
