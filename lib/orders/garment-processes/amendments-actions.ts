"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { gpAmendmentInput, type GpAmendmentInput } from "./amendments-types";

type ActionResult = { ok: true } | { ok: false; error: string };

function processesPath(orderId: string) {
  return `/orders/${orderId}/processes`;
}

// ---------- raise ----------

export async function raiseProcessAmendment(
  payload: GpAmendmentInput,
): Promise<ActionResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = gpAmendmentInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_process_amendments")
    .insert({ ...parsed.data, status: "pending" });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(processesPath(parsed.data.sales_order_id));
  return { ok: true };
}

// ---------- approve / reject ----------

async function decide(
  amendmentId: string,
  status: "approved" | "rejected",
  reason: string | null,
): Promise<ActionResult> {
  if (!(await can("orders", "approve"))) {
    throw new Error("Forbidden");
  }

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: amendment, error: fetchErr } = await supabase
    .from("garment_process_amendments")
    .select("sales_order_id, status")
    .eq("id", amendmentId)
    .single();

  if (fetchErr || !amendment) {
    return { ok: false, error: "Amendment not found" };
  }
  if (amendment.status !== "pending") {
    return { ok: false, error: "Amendment is no longer pending" };
  }

  const { error } = await supabase
    .from("garment_process_amendments")
    .update({
      status,
      decided_by: user?.id ?? null,
      decided_at: new Date().toISOString(),
      decided_reason: reason,
    })
    .eq("id", amendmentId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: `garment_process_amendment.${status}`,
    entityType: "sales_order",
    entityId: amendment.sales_order_id as string,
    metadata: { amendmentId },
  });

  revalidatePath(processesPath(amendment.sales_order_id as string));
  return { ok: true };
}

export async function approveProcessAmendment(
  amendmentId: string,
): Promise<ActionResult> {
  return decide(amendmentId, "approved", null);
}

export async function rejectProcessAmendment(
  amendmentId: string,
  reason: string,
): Promise<ActionResult> {
  if (!reason.trim()) {
    return { ok: false, error: "Please provide a reason for rejection." };
  }
  return decide(amendmentId, "rejected", reason.trim());
}
