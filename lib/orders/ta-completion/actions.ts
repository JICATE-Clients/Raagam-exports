"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { taCompletionInput, type TaCompletionInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/orders/ta-completion";

/**
 * Log a TA (Time & Action) completion for an order. Unlike Garment Order
 * Completion, this does NOT flip the order status — there is no T&A completion
 * state to toggle, so it just records the completion. Reuses 'orders'.
 */
export async function createTaCompletion(payload: TaCompletionInput): Promise<Result> {
  if (!(await can("orders", "create"))) {
    return { ok: false, error: "Forbidden" };
  }

  const parsed = taCompletionInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { order_id, customer_id, order_no, completion_date, remarks } = parsed.data;
  const completion_year = Number(completion_date.slice(0, 4)) || null;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ta_completions")
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
    return { ok: false, error: error?.message ?? "Failed to record TA completion" };
  }

  await writeAudit({
    action: "ta_completion.created",
    entityType: "ta_completion",
    entityId: data.id,
  });

  revalidatePath(LIST_PATH);
  revalidatePath("/orders");
  return { ok: true };
}
