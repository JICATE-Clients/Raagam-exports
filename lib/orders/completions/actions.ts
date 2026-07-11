"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { orderCompletionInput, type OrderCompletionInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/orders/completions";

/**
 * Complete a garment order: record a completion (date + derived year), then
 * flip the order's status to 'closed'. Reuses the 'orders' permission.
 */
export async function completeOrder(
  payload: OrderCompletionInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = orderCompletionInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { order_id, customer_id, order_no, completion_date, remarks } = parsed.data;
  // Legacy "Completion Yr" — derived from the completion date (YYYY-MM-DD).
  const completion_year = Number(completion_date.slice(0, 4)) || null;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("order_completions")
    .insert({
      order_id,
      customer_id: customer_id ?? null,
      order_no: order_no || null,
      completion_date,
      completion_year,
      remarks: remarks || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to complete order" };
  }

  const { error: sErr } = await supabase
    .from("sales_orders")
    .update({ status: "closed" })
    .eq("id", order_id);

  if (sErr) {
    return { ok: false, error: sErr.message };
  }

  await writeAudit({
    action: "order.completed",
    entityType: "sales_order",
    entityId: order_id,
  });

  revalidatePath(LIST_PATH);
  revalidatePath("/orders");
  return { ok: true };
}
