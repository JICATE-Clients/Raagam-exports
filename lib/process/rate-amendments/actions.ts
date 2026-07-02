"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { rateAmendmentInput, type RateAmendmentInput } from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/process/rate-amendments";

export async function createRateAmendment(
  payload: RateAmendmentInput,
): Promise<ActionResult> {
  if (!(await can("process_planning", "create"))) throw new Error("Forbidden");
  const parsed = rateAmendmentInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  // snapshot the current confirmed rate
  const { data: rfq } = await supabase
    .from("process_rfqs")
    .select("confirmed_rate")
    .eq("id", parsed.data.process_rfq_id)
    .single();

  const { error } = await supabase.from("process_rate_amendments").insert({
    ...parsed.data,
    old_rate: rfq?.confirmed_rate ?? null,
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function approveRateAmendment(id: string): Promise<ActionResult> {
  if (!(await can("process_planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();

  const { data: amendment, error: aErr } = await supabase
    .from("process_rate_amendments")
    .select("id, process_rfq_id, new_rate, status")
    .eq("id", id)
    .single();
  if (aErr || !amendment) return { ok: false, error: "Amendment not found" };
  if (amendment.status !== "pending") {
    return { ok: false, error: "Amendment is no longer pending" };
  }

  const { error: updErr } = await supabase
    .from("process_rate_amendments")
    .update({
      status: "approved",
      decided_by: user?.id ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) return { ok: false, error: updErr.message };

  // apply the new rate to the process RFQ
  const { error: rfqErr } = await supabase
    .from("process_rfqs")
    .update({ confirmed_rate: amendment.new_rate })
    .eq("id", amendment.process_rfq_id);
  if (rfqErr) {
    return { ok: false, error: `Approved, but failed to apply rate: ${rfqErr.message}` };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function rejectRateAmendment(
  id: string,
  reason: string,
): Promise<ActionResult> {
  if (!(await can("process_planning", "approve"))) throw new Error("Forbidden");
  if (!reason.trim()) {
    return { ok: false, error: "Please provide a reason for rejection." };
  }
  const user = await getAppUser();
  const supabase = await createClient();

  const { data: amendment } = await supabase
    .from("process_rate_amendments")
    .select("status")
    .eq("id", id)
    .single();
  if (!amendment) return { ok: false, error: "Amendment not found" };
  if (amendment.status !== "pending") {
    return { ok: false, error: "Amendment is no longer pending" };
  }

  const { error } = await supabase
    .from("process_rate_amendments")
    .update({
      status: "rejected",
      decided_by: user?.id ?? null,
      decided_at: new Date().toISOString(),
      decided_reason: reason.trim(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(LIST_PATH);
  return { ok: true };
}
