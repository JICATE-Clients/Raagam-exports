"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { resolveWriteLocation } from "@/lib/auth/location";
import { writeAudit } from "@/lib/audit";
import {
  receivableInput,
  receivableReceiptInput,
  type ReceivableInput,
  type ReceivableReceiptInput,
} from "@/lib/finance/types";
import { forexToInr, money } from "@/lib/finance/calc";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateResult = { ok: true; receivableId: string } | ErrResult;

// ---------- createReceivable ----------

export async function createReceivable(
  payload: ReceivableInput,
): Promise<CreateResult> {
  if (!(await can("finance", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = receivableInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { amount_fc, exchange_rate, ...rest } = parsed.data;
  const amount_inr = forexToInr(amount_fc, exchange_rate);

  // THE UNIT COMES FROM THE SESSION, NOT FROM THE FORM.
  //
  // `new-receivable-form.tsx` hardcoded `location_id: null`, so every invoice
  // ever raised here belonged to no GST entity. Stamping in the ACTION rather
  // than the form is the same choice AGENTS.md makes for the CAPITALS
  // transform: a rule at the call site is a rule the next call site can forget,
  // and this action has more than one caller ahead of it.
  //
  // `rest` is spread BEFORE this, so the session value wins over anything the
  // client sent — a payload is not allowed to name a unit the operator has not
  // switched to. RLS would refuse it anyway (0484's WITH CHECK), but failing
  // here says why in words the operator can act on.
  const loc = await resolveWriteLocation();
  if (!loc.ok) return { ok: false, error: loc.error };

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: receivable, error } = await supabase
    .from("receivables")
    .insert({
      ...rest,
      location_id: loc.locationId,
      amount_fc,
      exchange_rate,
      amount_inr,
      received_fc: 0,
      status: "open",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !receivable) {
    return { ok: false, error: error?.message ?? "Failed to create receivable" };
  }

  await writeAudit({
    action: "finance.receivable_created",
    entityType: "receivable",
    entityId: receivable.id as string,
    metadata: { amount_fc, currency_code: rest.currency_code, amount_inr },
  });

  revalidatePath("/finance/receivables");
  return { ok: true, receivableId: receivable.id as string };
}

// ---------- updateReceivable ----------

export async function updateReceivable(
  receivableId: string,
  payload: Partial<ReceivableInput>,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("receivables")
    .update(payload)
    .eq("id", receivableId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/finance/receivables/${receivableId}`);
  revalidatePath("/finance/receivables");
  return { ok: true };
}

// ---------- recordReceipt ----------

export async function recordReceipt(
  payload: ReceivableReceiptInput,
): Promise<ActionResult> {
  if (!(await can("finance", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = receivableReceiptInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { receivable_id, amount_fc, exchange_rate, ...rest } = parsed.data;
  const amount_inr = forexToInr(amount_fc, exchange_rate);

  const user = await getAppUser();
  const supabase = await createClient();

  // Load current state to compute new received_fc and status
  const { data: receivable, error: fetchError } = await supabase
    .from("receivables")
    .select("received_fc, amount_fc, status")
    .eq("id", receivable_id)
    .single();

  if (fetchError || !receivable) {
    return { ok: false, error: fetchError?.message ?? "Receivable not found" };
  }

  if ((receivable.status as string) === "cancelled") {
    return { ok: false, error: "Cannot record receipt on a cancelled receivable" };
  }

  const { error: receiptError } = await supabase.from("receivable_receipts").insert({
    receivable_id,
    amount_fc,
    exchange_rate,
    amount_inr,
    ...rest,
    created_by: user?.id ?? null,
  });

  if (receiptError) {
    return { ok: false, error: receiptError.message };
  }

  const newReceivedFc = money((receivable.received_fc as number) + amount_fc);
  const newStatus =
    newReceivedFc >= (receivable.amount_fc as number) ? "received" : "partially_received";

  const { error: updateError } = await supabase
    .from("receivables")
    .update({ received_fc: newReceivedFc, status: newStatus })
    .eq("id", receivable_id);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  await writeAudit({
    action: "finance.receipt_recorded",
    entityType: "receivable",
    entityId: receivable_id,
    metadata: { amount_fc, exchange_rate, amount_inr, new_status: newStatus },
  });

  revalidatePath(`/finance/receivables/${receivable_id}`);
  revalidatePath("/finance/receivables");
  return { ok: true };
}
