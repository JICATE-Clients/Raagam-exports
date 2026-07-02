"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  indentInput,
  indentLineInput,
  overBudgetInput,
  rateAmendmentInput,
  labStandardInput,
  labTestInput,
  variancePct,
} from "./extras-types";
import type {
  IndentInput,
  IndentLineInput,
  OverBudgetInput,
  RateAmendmentInput,
  LabStandardInput,
  LabTestInput,
} from "./extras-types";

type Err = { ok: false; error: string };
type Ok = { ok: true };
type R = Ok | Err;

async function guard(action: "create" | "edit" | "delete" | "approve"): Promise<void> {
  if (!(await can("materials_purchase", action))) throw new Error("Forbidden");
}
async function uid(): Promise<string | null> {
  const u = await getAppUser();
  return u?.id ?? null;
}
function bad(m: string): Err {
  return { ok: false, error: m };
}

// ============================================================================
// Purchase Indents
// ============================================================================
function revalidateIndents(id?: string): void {
  if (id) revalidatePath(`/purchase/indents/${id}`);
  revalidatePath("/purchase/indents");
  revalidatePath("/purchase");
}

export async function createPurchaseIndent(
  payload: IndentInput,
): Promise<{ ok: true; indentId: string } | Err> {
  await guard("create");
  const p = indentInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("purchase_indents")
    .insert({ ...p.data, status: "open", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create indent");
  revalidateIndents(data.id);
  return { ok: true, indentId: data.id };
}

export async function addIndentLine(indentId: string, payload: IndentLineInput): Promise<R> {
  await guard("edit");
  const p = indentLineInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s
    .from("purchase_indent_lines")
    .insert({ ...p.data, purchase_indent_id: indentId });
  if (error) return bad(error.message);
  revalidateIndents(indentId);
  return { ok: true };
}

export async function deleteIndentLine(id: string, indentId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("purchase_indent_lines").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateIndents(indentId);
  return { ok: true };
}

async function setIndentStatus(id: string, from: string, to: string, ok: string): Promise<R> {
  const s = await createClient();
  const { data: row } = await s.from("purchase_indents").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== from) return bad(`Indent is not in ${from} status`);
  const { error } = await s.from("purchase_indents").update({ status: to }).eq("id", id);
  if (error) return bad(error.message);
  revalidateIndents(id);
  void ok;
  return { ok: true };
}

export async function acknowledgeIndent(id: string): Promise<R> {
  await guard("edit");
  return setIndentStatus(id, "open", "acknowledged", "Acknowledged");
}
export async function convertIndent(id: string): Promise<R> {
  await guard("edit");
  return setIndentStatus(id, "acknowledged", "converted", "Converted");
}
export async function cancelIndent(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("purchase_indents").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateIndents(id);
  return { ok: true };
}
export async function deleteIndent(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("purchase_indents").select("status").eq("id", id).maybeSingle();
  if (!row || !["open", "cancelled"].includes(row.status))
    return bad("Only open or cancelled indents can be deleted");
  const { error } = await s.from("purchase_indents").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateIndents();
  return { ok: true };
}

// ============================================================================
// Over-budget confirmations
// ============================================================================
function revalidateOB(): void {
  revalidatePath("/purchase/over-budget");
  revalidatePath("/purchase");
}

export async function raiseOverBudget(payload: OverBudgetInput): Promise<R> {
  await guard("create");
  const p = overBudgetInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("over_budget_confirmations").insert({
    ...p.data,
    variance_pct: variancePct(p.data.budget_rate, p.data.quoted_rate),
    status: "draft",
    created_by: await uid(),
  });
  if (error) return bad(error.message);
  revalidateOB();
  return { ok: true };
}

export async function submitOverBudget(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("over_budget_confirmations").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Not in draft status");
  const { error } = await s.from("over_budget_confirmations").update({ status: "submitted" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateOB();
  return { ok: true };
}

export async function approveOverBudget(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("over_budget_confirmations").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "submitted") return bad("Not in submitted status");
  const { error } = await s
    .from("over_budget_confirmations")
    .update({ status: "approved", approved_by: await uid(), approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return bad(error.message);
  await writeAudit({ action: "over_budget.approved", entityType: "over_budget_confirmation", entityId: id });
  revalidateOB();
  return { ok: true };
}

export async function rejectOverBudget(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("over_budget_confirmations").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "submitted") return bad("Not in submitted status");
  const { error } = await s.from("over_budget_confirmations").update({ status: "rejected" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateOB();
  return { ok: true };
}

// ============================================================================
// PO rate amendments
// ============================================================================
function revalidateRA(): void {
  revalidatePath("/purchase/rate-amendments");
  revalidatePath("/purchase");
}

export async function raiseRateAmendment(payload: RateAmendmentInput): Promise<R> {
  await guard("create");
  const p = rateAmendmentInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data: line } = await s
    .from("po_line_items")
    .select("unit_price, purchase_order_id")
    .eq("id", p.data.po_line_item_id)
    .maybeSingle();
  if (!line || line.purchase_order_id !== p.data.purchase_order_id)
    return bad("Line does not belong to the selected PO");
  const { error } = await s.from("po_rate_amendments").insert({
    purchase_order_id: p.data.purchase_order_id,
    po_line_item_id: p.data.po_line_item_id,
    previous_rate: (line.unit_price as number) ?? 0,
    revised_rate: p.data.revised_rate,
    reason: p.data.reason,
    status: "draft",
    created_by: await uid(),
  });
  if (error) return bad(error.message);
  revalidateRA();
  return { ok: true };
}

export async function submitRateAmendment(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("po_rate_amendments").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Not in draft status");
  const { error } = await s.from("po_rate_amendments").update({ status: "submitted" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateRA();
  return { ok: true };
}

export async function approveRateAmendment(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: amd } = await s
    .from("po_rate_amendments")
    .select("status, purchase_order_id, po_line_item_id, revised_rate")
    .eq("id", id)
    .maybeSingle();
  if (!amd || amd.status !== "submitted") return bad("Not in submitted status");

  // apply the new rate to the PO line + recompute its amount
  if (amd.po_line_item_id) {
    const { data: line } = await s
      .from("po_line_items")
      .select("quantity")
      .eq("id", amd.po_line_item_id as string)
      .maybeSingle();
    const qty = (line?.quantity as number) ?? 0;
    const revised = amd.revised_rate as number;
    const { error: lineErr } = await s
      .from("po_line_items")
      .update({ unit_price: revised, amount: qty * revised })
      .eq("id", amd.po_line_item_id as string);
    if (lineErr) return bad(lineErr.message);

    // recompute PO total from all its lines
    const { data: lines } = await s
      .from("po_line_items")
      .select("amount")
      .eq("purchase_order_id", amd.purchase_order_id as string);
    const total = ((lines ?? []) as { amount: number }[]).reduce((sum, l) => sum + (l.amount ?? 0), 0);
    await s.from("purchase_orders").update({ total_amount: total }).eq("id", amd.purchase_order_id as string);
  }

  const { error } = await s
    .from("po_rate_amendments")
    .update({ status: "approved", approved_by: await uid(), approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return bad(error.message);

  await writeAudit({
    action: "po_rate_amendment.approved",
    entityType: "po_rate_amendment",
    entityId: id,
    metadata: { purchase_order_id: amd.purchase_order_id, revised_rate: amd.revised_rate },
  });
  revalidateRA();
  revalidatePath(`/purchase/orders/${amd.purchase_order_id as string}`);
  return { ok: true };
}

export async function rejectRateAmendment(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("po_rate_amendments").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "submitted") return bad("Not in submitted status");
  const { error } = await s.from("po_rate_amendments").update({ status: "rejected" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateRA();
  return { ok: true };
}

// ============================================================================
// PO cancellations
// ============================================================================
export async function cancelPurchaseOrder(poId: string, reason: string): Promise<R> {
  await guard("edit");
  if (!reason.trim()) return bad("A cancellation reason is required");
  const s = await createClient();

  const { data: po } = await s.from("purchase_orders").select("status").eq("id", poId).maybeSingle();
  if (!po) return bad("PO not found");
  if (["cancelled", "closed", "received"].includes(po.status))
    return bad(`A ${po.status} PO cannot be cancelled`);

  const { error: cErr } = await s
    .from("po_cancellations")
    .insert({ purchase_order_id: poId, reason: reason.trim(), cancelled_by: await uid() });
  if (cErr) return bad(cErr.message);

  const { error: uErr } = await s.from("purchase_orders").update({ status: "cancelled" }).eq("id", poId);
  if (uErr) return bad(uErr.message);

  await writeAudit({ action: "purchase_order.cancelled", entityType: "purchase_order", entityId: poId });
  revalidatePath("/purchase/po-cancellations");
  revalidatePath(`/purchase/orders/${poId}`);
  revalidatePath("/purchase");
  return { ok: true };
}

// ============================================================================
// Lab
// ============================================================================
function revalidateLab(): void {
  revalidatePath("/purchase/lab");
  revalidatePath("/purchase");
}

export async function createLabStandard(payload: LabStandardInput): Promise<R> {
  await guard("create");
  const p = labStandardInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("lab_test_standards").insert({ ...p.data, created_by: await uid() });
  if (error) return bad(error.message);
  revalidateLab();
  return { ok: true };
}

export async function deleteLabStandard(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("lab_test_standards").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateLab();
  return { ok: true };
}

export async function createLabTest(payload: LabTestInput): Promise<R> {
  await guard("create");
  const p = labTestInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("lab_tests").insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revalidateLab();
  return { ok: true };
}

export async function issueLabTest(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("lab_tests").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Only a draft test can be issued");
  const { error } = await s
    .from("lab_tests")
    .update({ status: "issued", tested_date: new Date().toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidateLab();
  return { ok: true };
}

export async function recordLabResult(
  id: string,
  outcome: "passed" | "failed",
  resultValue: number | null,
  note: string | null,
): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("lab_tests").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "issued"].includes(row.status))
    return bad("Result can only be recorded on a draft/issued test");
  const { error } = await s
    .from("lab_tests")
    .update({
      status: outcome,
      result_value: resultValue,
      result_note: note,
      tested_date: new Date().toISOString().slice(0, 10),
    })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidateLab();
  return { ok: true };
}

export async function deleteLabTest(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("lab_tests").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateLab();
  return { ok: true };
}
