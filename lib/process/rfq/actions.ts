"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  processRfqInput,
  processQuoteInput,
  type ProcessRfqInput,
  type ProcessQuoteInput,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; rfqId: string } | { ok: false; error: string };

const LIST_PATH = "/process/rfq";

export async function createProcessRfq(
  payload: ProcessRfqInput,
): Promise<CreateResult> {
  if (!(await can("process_planning", "create"))) throw new Error("Forbidden");
  const parsed = processRfqInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("process_rfqs")
    .insert(parsed.data)
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create RFQ" };
  }
  revalidatePath(LIST_PATH);
  return { ok: true, rfqId: data.id };
}

export async function addProcessQuote(
  rfqId: string,
  data: ProcessQuoteInput,
): Promise<ActionResult> {
  if (!(await can("process_planning", "edit"))) throw new Error("Forbidden");
  const parsed = processQuoteInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("process_rfq_quotes")
    .insert({ ...parsed.data, rfq_id: rfqId });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`${LIST_PATH}/${rfqId}`);
  return { ok: true };
}

export async function deleteProcessQuote(
  quoteId: string,
  rfqId: string,
): Promise<ActionResult> {
  if (!(await can("process_planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("process_rfq_quotes").delete().eq("id", quoteId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`${LIST_PATH}/${rfqId}`);
  return { ok: true };
}

/** Award a quote — confirms the vendor + rate. Blocks if rate > budget and over-budget not approved. */
export async function confirmProcessQuote(quoteId: string): Promise<ActionResult> {
  if (!(await can("process_planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();

  const { data: quote, error: qErr } = await supabase
    .from("process_rfq_quotes")
    .select("id, rfq_id, vendor_id, rate")
    .eq("id", quoteId)
    .single();
  if (qErr || !quote) return { ok: false, error: "Quote not found" };

  const { data: rfq, error: rErr } = await supabase
    .from("process_rfqs")
    .select("id, budget_rate, over_budget_approved")
    .eq("id", quote.rfq_id)
    .single();
  if (rErr || !rfq) return { ok: false, error: "RFQ not found" };

  if (
    Number(quote.rate) > Number(rfq.budget_rate) &&
    !rfq.over_budget_approved
  ) {
    return {
      ok: false,
      error: "Quote rate exceeds the budget rate — approve over-budget first.",
    };
  }

  const { error } = await supabase
    .from("process_rfqs")
    .update({
      confirmed_vendor_id: quote.vendor_id,
      confirmed_rate: quote.rate,
      status: "confirmed",
    })
    .eq("id", quote.rfq_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`${LIST_PATH}/${quote.rfq_id}`);
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function approveOverBudget(rfqId: string): Promise<ActionResult> {
  if (!(await can("process_planning", "approve"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("process_rfqs")
    .update({ over_budget_approved: true })
    .eq("id", rfqId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`${LIST_PATH}/${rfqId}`);
  return { ok: true };
}

export async function cancelProcessRfq(rfqId: string): Promise<ActionResult> {
  if (!(await can("process_planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("process_rfqs")
    .update({ status: "cancelled" })
    .eq("id", rfqId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`${LIST_PATH}/${rfqId}`);
  revalidatePath(LIST_PATH);
  return { ok: true };
}
