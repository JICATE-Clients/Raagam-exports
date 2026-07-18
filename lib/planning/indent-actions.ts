"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { indentApprovalInput, indentConversionInput } from "./indent-types";
import type { IndentApprovalInput, IndentConversionInput } from "./indent-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function rev(): void { revalidatePath("/planning"); revalidatePath("/planning/indent-approval"); revalidatePath("/planning/indent-to-purchase"); }

// ---------------------------------------------------------------------------
// Indent Approval
// ---------------------------------------------------------------------------

export async function createIndentApproval(data: IndentApprovalInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = indentApprovalInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { items, ...header } = p.data;
  const { data: row, error } = await s.from("indent_approvals").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (items.length > 0) {
    const { error: childErr } = await s.from("indent_approval_items").insert(
      items.map((item, i) => ({ indent_approval_id: row.id, sno: i + 1, ...item })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function approveIndent(approvalId: string, remarks?: string): Promise<Result> {
  if (!(await can("planning", "approve"))) return fail("Forbidden");
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  const { error } = await s.from("indent_approvals").update({
    approval_status: "approved",
    approved_by: user?.id,
    approved_at: new Date().toISOString(),
    remarks: remarks || null,
  }).eq("id", approvalId);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function rejectIndent(approvalId: string, remarks?: string): Promise<Result> {
  if (!(await can("planning", "approve"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("indent_approvals").update({
    approval_status: "rejected",
    remarks: remarks || null,
  }).eq("id", approvalId);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function addIndentApprovalItem(approvalId: string, data: { category_name?: string | null; item_description?: string | null; uom_id?: string | null; qty?: number; is_approved?: boolean | null; remarks?: string | null }): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("indent_approval_items").select("sno").eq("indent_approval_id", approvalId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("indent_approval_items").insert({ indent_approval_id: approvalId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteIndentApproval(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("indent_approvals").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Indent to Purchase Conversion
// ---------------------------------------------------------------------------

export async function createIndentConversion(data: IndentConversionInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = indentConversionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { items, ...header } = p.data;
  const { data: row, error } = await s.from("indent_conversions").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (items.length > 0) {
    const { error: childErr } = await s.from("indent_conversion_items").insert(
      items.map((item, i) => ({
        conversion_id: row.id, sno: i + 1,
        ...item,
        po_value: Math.round((item.qty ?? 0) * (item.rate ?? 0) * 100) / 100,
      })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function convertIndent(id: string): Promise<Result> {
  if (!(await can("planning", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("indent_conversions").update({ status: "converted" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function addConversionItem(conversionId: string, data: { item_class_name?: string | null; item_description?: string | null; uom_id?: string | null; qty?: number; rate?: number; vendor_name?: string | null; required_date?: string | null }): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("indent_conversion_items").select("sno").eq("conversion_id", conversionId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const qty = data.qty ?? 0;
  const rate = data.rate ?? 0;
  const { data: row, error } = await s.from("indent_conversion_items").insert({
    conversion_id: conversionId, sno,
    ...data,
    po_value: Math.round(qty * rate * 100) / 100,
  }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteIndentConversion(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("indent_conversions").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
