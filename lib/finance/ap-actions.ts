"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { payableInput, payablePaymentInput } from "./types";
import type { PayableInput, PayablePaymentInput } from "./types";
import { money, threeWayMatchStatus, payableOutstanding } from "./calc";
import { computeGrnValue } from "./ap-service";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;

function revalidatePayables(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/finance/payables");
}

// ---------- helpers ----------

async function resolveMatchStatus(
  totalAmount: number,
  purchaseOrderId: string | null | undefined,
  grnId: string | null | undefined,
): Promise<"unmatched" | "matched" | "exception"> {
  if (!purchaseOrderId || !grnId) return "unmatched";

  const supabase = await createClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("total_amount")
    .eq("id", purchaseOrderId)
    .maybeSingle();

  const poAmount = po ? (po as { total_amount: number }).total_amount : null;
  const grnValue = await computeGrnValue(grnId);

  return threeWayMatchStatus(totalAmount, poAmount, grnValue);
}

// ---------- payable actions ----------

export async function createPayable(
  data: PayableInput,
): Promise<{ ok: true; payableId: string } | ErrResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");

  const parsed = payableInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { amount, tax_amount, purchase_order_id, grn_id, ...rest } = parsed.data;
  const totalAmount = money(amount + (tax_amount ?? 0));
  const matchStatus = await resolveMatchStatus(totalAmount, purchase_order_id, grn_id);

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: payable, error } = await supabase
    .from("payables")
    .insert({
      ...rest,
      purchase_order_id: purchase_order_id ?? null,
      grn_id: grn_id ?? null,
      amount,
      tax_amount: tax_amount ?? 0,
      total_amount: totalAmount,
      paid_amount: 0,
      match_status: matchStatus,
      status: "draft",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !payable) {
    return { ok: false, error: error?.message ?? "Failed to create payable" };
  }

  await writeAudit({
    action: "payable.created",
    entityType: "payable",
    entityId: payable.id,
    locationId: rest.location_id,
    metadata: { total_amount: totalAmount, match_status: matchStatus },
  });

  revalidatePayables();
  return { ok: true, payableId: payable.id };
}

export async function updatePayable(
  id: string,
  data: PayableInput,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");

  const parsed = payableInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Block editing paid/cancelled bills
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("payables")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  const existingStatus = (existing as { status: string } | null)?.status;
  if (existingStatus === "paid" || existingStatus === "cancelled") {
    return { ok: false, error: "Cannot edit a paid or cancelled bill" };
  }

  const { amount, tax_amount, purchase_order_id, grn_id, ...rest } = parsed.data;
  const totalAmount = money(amount + (tax_amount ?? 0));
  const matchStatus = await resolveMatchStatus(totalAmount, purchase_order_id, grn_id);

  const { error } = await supabase
    .from("payables")
    .update({
      ...rest,
      purchase_order_id: purchase_order_id ?? null,
      grn_id: grn_id ?? null,
      amount,
      tax_amount: tax_amount ?? 0,
      total_amount: totalAmount,
      match_status: matchStatus,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePayables(`/finance/payables/${id}`);
  return { ok: true };
}

export async function approvePayable(id: string): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: payable } = await supabase
    .from("payables")
    .select("status, code, total_amount")
    .eq("id", id)
    .maybeSingle();

  const row = payable as { status: string; code: string | null; total_amount: number } | null;
  if (!row || row.status !== "draft") {
    return { ok: false, error: "Bill is not in draft status" };
  }

  const { error } = await supabase
    .from("payables")
    .update({ status: "approved" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "payable.approved",
    entityType: "payable",
    entityId: id,
    metadata: { code: row.code, total_amount: row.total_amount },
  });

  revalidatePayables(`/finance/payables/${id}`);
  return { ok: true };
}

export async function recordPayment(
  data: PayablePaymentInput,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");

  const parsed = payablePaymentInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: payable } = await supabase
    .from("payables")
    .select("status, paid_amount, total_amount, code")
    .eq("id", parsed.data.payable_id)
    .maybeSingle();

  const row = payable as {
    status: string;
    paid_amount: number;
    total_amount: number;
    code: string | null;
  } | null;

  if (!row) {
    return { ok: false, error: "Bill not found" };
  }
  if (row.status === "paid" || row.status === "cancelled") {
    return { ok: false, error: "Cannot record payment on a paid or cancelled bill" };
  }
  if (row.status === "draft") {
    return { ok: false, error: "Bill must be approved before recording payment" };
  }

  const outstanding = payableOutstanding({ total_amount: row.total_amount, paid_amount: row.paid_amount });
  if (parsed.data.amount > outstanding + 0.01) {
    return { ok: false, error: `Payment amount exceeds outstanding balance of ${outstanding}` };
  }

  const user = await getAppUser();
  const { error: payErr } = await supabase.from("payable_payments").insert({
    ...parsed.data,
    created_by: user?.id ?? null,
  });
  if (payErr) return { ok: false, error: payErr.message };

  const newPaid = money(row.paid_amount + parsed.data.amount);
  const newStatus = newPaid >= row.total_amount - 0.01 ? "paid" : "partially_paid";

  const { error: updateErr } = await supabase
    .from("payables")
    .update({ paid_amount: newPaid, status: newStatus })
    .eq("id", parsed.data.payable_id);
  if (updateErr) return { ok: false, error: updateErr.message };

  await writeAudit({
    action: "payable.payment_recorded",
    entityType: "payable",
    entityId: parsed.data.payable_id,
    metadata: {
      code: row.code,
      amount: parsed.data.amount,
      method: parsed.data.method,
      new_status: newStatus,
    },
  });

  revalidatePayables(`/finance/payables/${parsed.data.payable_id}`);
  return { ok: true };
}
