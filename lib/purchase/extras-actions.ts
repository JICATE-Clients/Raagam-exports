"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { deleteOrDeactivate } from "@/lib/masters/delete-guard";
import { actOnSubject, startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getRequirementLines } from "./re-po/service";
import { budgetRateOf, lineKeyOf } from "./re-po/types";
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
/** A delete that may have soft-disabled instead — the screen needs both halves
 *  to say "marked inactive because it is used by X" rather than "deleted". */
type DeleteR = { ok: true; inactive: boolean; usedBy?: string } | Err;

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
  const s = await createClient();

  // Verify indent is acknowledged
  const { data: indent } = await s
    .from("purchase_indents")
    .select("id, status, department, sales_order_id, garment_ppm_id")
    .eq("id", id)
    .maybeSingle();
  if (!indent || indent.status !== "acknowledged")
    return bad("Indent is not in acknowledged status");

  // Create a draft PO linked to this indent
  const user = await getAppUser();
  const { data: po, error: poErr } = await s
    .from("purchase_orders")
    .insert({
      purchase_indent_id: id,
      vendor_id: "00000000-0000-0000-0000-000000000000", // placeholder — user must set vendor
      status: "draft",
      order_date: new Date().toISOString().slice(0, 10),
      notes: `Created from indent ${indent.id}`,
      created_by: user?.id ?? null,
    })
    .select("id")
    .maybeSingle();

  if (poErr || !po) return bad(poErr?.message ?? "Failed to create PO");

  // Mark indent as converted
  const { error } = await s
    .from("purchase_indents")
    .update({ status: "converted" })
    .eq("id", id);
  if (error) return bad(error.message);

  revalidateIndents(id);
  revalidatePath("/purchase/orders");
  return { ok: true };
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

/**
 * SUBMIT = A RUN IN MY APPROVALS (0785). The amendment goes `submitted` and a
 * `po_rate_amendment` run starts; the run's final approve writes the rate, GST and
 * the PO total (`po_rate_amendment_apply_decision`) — never this screen.
 *
 * The budget question is asked here the way Raise PO asks it: `po_budget_check`
 * answers yes / no for the revised rate WITH its GST (re-po/types.ts `budgetRateOf`),
 * so the Purchase Manager never sees the budget figure (spec point 7). The MD's card
 * reads the figure itself.
 */
export async function submitRateAmendment(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s
    .from("po_rate_amendments")
    .select("id, code, status, previous_rate, revised_rate, reason, purchase_order_id, po_line_item_id")
    .eq("id", id)
    .maybeSingle();
  const amd = row as {
    id: string; code: string | null; status: string; previous_rate: number; revised_rate: number; reason: string;
    purchase_order_id: string; po_line_item_id: string | null;
  } | null;
  if (!amd || amd.status !== "draft") return bad("Not in draft status");
  if (!amd.po_line_item_id) return bad("This amendment names no PO line — raise it again");

  const [{ data: lineRow }, { data: poRow }] = await Promise.all([
    s
      .from("po_line_items")
      .select("id, description, quantity, unit_price, gst_pct, uom_id, item_id, req_key, garment_order_id, iwo_id")
      .eq("id", amd.po_line_item_id)
      .maybeSingle(),
    s
      .from("purchase_orders")
      .select("id, code, status, po_type, exchange_rate, gst_pct, foreign_currency_code")
      .eq("id", amd.purchase_order_id)
      .maybeSingle(),
  ]);
  const line = lineRow as {
    id: string; description: string | null; quantity: number; unit_price: number; gst_pct: number | null;
    uom_id: string | null; item_id: string | null; req_key: string | null; garment_order_id: string | null; iwo_id: string | null;
  } | null;
  const po = poRow as {
    id: string; code: string | null; status: string; po_type: string | null; exchange_rate: number | null;
    gst_pct: number | null; foreign_currency_code: string | null;
  } | null;
  if (!line || !po) return bad("The PO line is no longer there — reload");
  if (["cancelled", "closed"].includes(po.status)) return bad(`A ${po.status} PO's rate cannot be amended`);

  // The hidden budget check, GST-inclusive (as Raise PO).
  const fx = po.po_type === "import" ? Number(po.exchange_rate ?? 0) || 1 : 1;
  const gstPct = Number(line.gst_pct ?? po.gst_pct ?? 0);
  let aboveBudget = false;
  let hasBudget = false;
  const src = line.garment_order_id ?? line.iwo_id;
  if (src && line.req_key && line.item_id && line.garment_order_id) {
    try {
      const req = (await getRequirementLines([src])).find((r) => lineKeyOf(r) === `${src}::${line.req_key}`);
      if (req) {
        const { data: flags, error: fErr } = await s.rpc("po_budget_check", {
          p_lines: [
            {
              key: line.id,
              garment_order_id: line.garment_order_id,
              item_id: line.item_id,
              uom_id: line.uom_id,
              slice_label: req.slice_label,
              colour: req.colour,
              rate: budgetRateOf(Number(amd.revised_rate), gstPct) * fx,
            },
          ],
        });
        if (fErr) return bad(`Could not check the rate against the budget: ${fErr.message}`);
        const f = ((flags ?? []) as { has_budget: boolean; above: boolean }[])[0];
        hasBudget = !!f?.has_budget;
        aboveBudget = !!f?.above;
      }
    } catch (e) {
      return bad(e instanceof Error ? e.message : "The budget check failed");
    }
  }

  const { error } = await s.from("po_rate_amendments").update({ status: "submitted" }).eq("id", id).eq("status", "draft");
  if (error) return bad(error.message);

  const qty = Number(line.quantity) || 0;
  const cur = po.po_type === "import" ? (po.foreign_currency_code ?? "") : "₹";
  const withGst = (rate: number) => Math.round(qty * rate * (1 + gstPct / 100) * 100) / 100;
  const started = await startApproval({
    workflowKey: WORKFLOWS.po_rate_amendment.key,
    subjectTable: WORKFLOWS.po_rate_amendment.subjectTable,
    subjectId: id,
    /* Frozen as sent — what the MD's alert and card say. Only the budget yes / no
       rides here; the MD's card reads the budget figure itself. */
    context: {
      amendment_code: amd.code,
      po_id: po.id,
      po_code: po.code,
      po_line_item_id: line.id,
      item: line.description,
      quantity: qty,
      currency: cur,
      previous_rate: Number(amd.previous_rate),
      revised_rate: Number(amd.revised_rate),
      gst_pct: gstPct,
      previous_value: withGst(Number(amd.previous_rate)),
      revised_value: withGst(Number(amd.revised_rate)),
      reason: amd.reason,
      has_budget: hasBudget,
      above_budget: aboveBudget,
    },
  });
  if (!started.ok) {
    // No run → nobody could decide it: back to draft, and say why.
    await s.from("po_rate_amendments").update({ status: "draft" }).eq("id", id).eq("status", "submitted");
    return bad(`Could not send it for approval: ${started.error}`);
  }
  revalidateRA();
  return { ok: true };
}

/** Approve from the Rate Amendments screen — through the run; its end writes the rate. */
export async function approveRateAmendment(id: string): Promise<R> {
  await guard("approve");
  const r = await actOnSubject({
    subjectTable: WORKFLOWS.po_rate_amendment.subjectTable,
    subjectId: id,
    action: "approve",
    subjectPath: "/purchase/rate-amendments",
  });
  if (!r.ok) return bad("noRun" in r ? "No approval is running for this amendment — submit it again" : r.error);
  await writeAudit({ action: "po_rate_amendment.approved", entityType: "po_rate_amendment", entityId: id });
  revalidateRA();
  return { ok: true };
}

/** Reject — the reason is mandatory (the engine refuses a reject without one). */
export async function rejectRateAmendment(id: string, reason: string): Promise<R> {
  await guard("approve");
  const why = reason.trim();
  if (!why) return bad("Give the reason for rejecting");
  const r = await actOnSubject({
    subjectTable: WORKFLOWS.po_rate_amendment.subjectTable,
    subjectId: id,
    action: "reject",
    comment: why,
    subjectPath: "/purchase/rate-amendments",
  });
  if (!r.ok) return bad("noRun" in r ? "No approval is running for this amendment" : r.error);
  await writeAudit({
    action: "po_rate_amendment.rejected",
    entityType: "po_rate_amendment",
    entityId: id,
    metadata: { reason: why },
  });
  revalidateRA();
  return { ok: true };
}

// ============================================================================
// PO cancellations
// ============================================================================
/**
 * DIRECT CANCEL — A DRAFT PO ONLY (0785). A draft has gone to nobody, so there is
 * nothing for the MD to approve; its raiser may withdraw it. An approved or partly
 * received PO is cancelled by `requestPoCancellation` (po-cancel-actions.ts), and a
 * PO waiting for approval is rejected on its own page.
 */
export async function cancelPurchaseOrder(poId: string, reason: string): Promise<R> {
  await guard("edit");
  if (!reason.trim()) return bad("A cancellation reason is required");
  const s = await createClient();

  const { data: po } = await s.from("purchase_orders").select("status").eq("id", poId).maybeSingle();
  if (!po) return bad("PO not found");
  if (po.status !== "draft")
    return bad(
      po.status === "pending_approval"
        ? "This PO is waiting for approval — reject it on its own page instead"
        : "An approved PO is cancelled by a request to the MD — use Request cancellation",
    );

  const { error: cErr } = await s
    .from("po_cancellations")
    .insert({ purchase_order_id: poId, reason: reason.trim(), cancelled_by: await uid() });
  if (cErr) return bad(cErr.message);

  const { error: uErr } = await s
    .from("purchase_orders")
    .update({ status: "cancelled" })
    .eq("id", poId)
    .eq("status", "draft");
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

export async function deleteLabStandard(id: string): Promise<DeleteR> {
  await guard("delete");
  const s = await createClient();
  // 0382 §3 kept this as a master when its duplicate CRUD was withdrawn — and
  // the CRUD that survived is this one, which was the unguarded copy. Its single
  // inbound FK is SET NULL, so a delete blanks the standard off a recorded lab
  // test in silence; the shared guard deactivates (`is_active`) instead.
  const res = await deleteOrDeactivate(s, "lab_test_standards", id, "is_active");
  if (!res.ok) return bad(res.error);
  revalidateLab();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
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
