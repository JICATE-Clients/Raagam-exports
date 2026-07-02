"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { orderProcessInput, type OrderProcessInput } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

function processesPath(orderId: string) {
  return `/orders/${orderId}/processes`;
}

// ---------- add a garment process to an order ----------

export async function addOrderProcess(
  payload: OrderProcessInput,
): Promise<ActionResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = orderProcessInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("order_garment_processes")
    .insert(parsed.data);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(processesPath(parsed.data.sales_order_id));
  return { ok: true };
}

// ---------- remove a garment process ----------

export async function deleteOrderProcess(
  processId: string,
  orderId: string,
): Promise<ActionResult> {
  if (!(await can("orders", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("order_garment_processes")
    .delete()
    .eq("id", processId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(processesPath(orderId));
  return { ok: true };
}
