"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  openingStockInput,
  openingStockLineInput,
  mrsInput,
  mrsLineInput,
  vendorReturnInput,
  vendorReturnLineInput,
  cspInput,
  cspLineInput,
} from "./extras-types";
import type {
  OpeningStockInput,
  OpeningStockLineInput,
  MrsInput,
  MrsLineInput,
  VendorReturnInput,
  VendorReturnLineInput,
  CspInput,
  CspLineInput,
} from "./extras-types";

type Err = { ok: false; error: string };
type Ok = { ok: true };
type R = Ok | Err;

async function guard(action: "create" | "edit" | "delete" | "approve"): Promise<void> {
  if (!(await can("stores", action))) throw new Error("Forbidden");
}
async function uid(): Promise<string | null> {
  const u = await getAppUser();
  return u?.id ?? null;
}
function bad(m: string): Err {
  return { ok: false, error: m };
}
function friendlyStock(msg: string): string {
  return msg.includes("Insufficient stock")
    ? "Insufficient stock — this posting would drive a balance negative"
    : msg;
}

type LedgerMovement = "receipt" | "issue" | "adjust_in";
interface LedgerRow {
  store_id: string;
  item_id: string;
  movement_type: LedgerMovement;
  quantity: number;
  reference_type: string;
  reference_id: string;
  note?: string | null;
}

/** Batch-insert ledger rows (>0 only). Atomic — the balance trigger rolls back
 *  the whole statement if any row would drive stock negative. */
async function postLedger(rows: LedgerRow[]): Promise<Err | null> {
  const payload = rows.filter((r) => r.quantity > 0);
  if (payload.length === 0) return bad("Nothing to post — all line quantities are zero");
  const s = await createClient();
  const userId = await uid();
  const { error } = await s
    .from("stock_ledger")
    .insert(payload.map((r) => ({ ...r, created_by: userId })));
  if (error) return bad(friendlyStock(error.message));
  return null;
}

// ============================================================================
// Opening Stock
// ============================================================================
function revalidateOpening(id?: string): void {
  if (id) revalidatePath(`/stores/opening-stock/${id}`);
  revalidatePath("/stores/opening-stock");
  revalidatePath("/stores");
}

export async function createOpeningStock(
  payload: OpeningStockInput,
): Promise<{ ok: true; id: string } | Err> {
  await guard("create");
  const p = openingStockInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("opening_stocks")
    .insert({ ...p.data, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create");
  revalidateOpening(data.id);
  return { ok: true, id: data.id };
}

export async function addOpeningLine(docId: string, payload: OpeningStockLineInput): Promise<R> {
  await guard("edit");
  const p = openingStockLineInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("opening_stock_lines").insert({ ...p.data, opening_stock_id: docId });
  if (error) return bad(error.message);
  revalidateOpening(docId);
  return { ok: true };
}

export async function deleteOpeningLine(id: string, docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("opening_stock_lines").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateOpening(docId);
  return { ok: true };
}

export async function postOpeningStock(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("opening_stocks").select("status, store_id").eq("id", docId).maybeSingle();
  if (!doc || doc.status !== "draft") return bad("Only a draft opening stock can be posted");
  const { data: lines } = await s.from("opening_stock_lines").select("item_id, quantity").eq("opening_stock_id", docId);
  const rows = ((lines ?? []) as { item_id: string; quantity: number }[]).map((l) => ({
    store_id: doc.store_id as string,
    item_id: l.item_id,
    movement_type: "adjust_in" as const,
    quantity: l.quantity ?? 0,
    reference_type: "opening_stock",
    reference_id: docId,
  }));
  const err = await postLedger(rows);
  if (err) return err;
  const { error } = await s.from("opening_stocks").update({ status: "posted" }).eq("id", docId);
  if (error) return bad(error.message);
  await writeAudit({ action: "opening_stock.posted", entityType: "opening_stock", entityId: docId });
  revalidateOpening(docId);
  return { ok: true };
}

export async function cancelOpeningStock(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("opening_stocks").select("status").eq("id", docId).maybeSingle();
  if (!doc || doc.status !== "draft") return bad("Only a draft opening stock can be cancelled");
  const { error } = await s.from("opening_stocks").update({ status: "cancelled" }).eq("id", docId);
  if (error) return bad(error.message);
  revalidateOpening(docId);
  return { ok: true };
}

export async function deleteOpeningStock(docId: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: doc } = await s.from("opening_stocks").select("status").eq("id", docId).maybeSingle();
  if (!doc || !["draft", "cancelled"].includes(doc.status))
    return bad("Only draft or cancelled documents can be deleted");
  const { error } = await s.from("opening_stocks").delete().eq("id", docId);
  if (error) return bad(error.message);
  revalidateOpening();
  return { ok: true };
}

// ============================================================================
// Material Requisitions
// ============================================================================
function revalidateMrs(id?: string): void {
  if (id) revalidatePath(`/stores/requisitions/${id}`);
  revalidatePath("/stores/requisitions");
  revalidatePath("/stores");
}

export async function createRequisition(payload: MrsInput): Promise<{ ok: true; id: string } | Err> {
  await guard("create");
  const p = mrsInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("material_requisitions")
    .insert({ ...p.data, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create");
  revalidateMrs(data.id);
  return { ok: true, id: data.id };
}

export async function addMrsLine(docId: string, payload: MrsLineInput): Promise<R> {
  await guard("edit");
  const p = mrsLineInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s
    .from("material_requisition_lines")
    .insert({ ...p.data, issued_qty: 0, material_requisition_id: docId });
  if (error) return bad(error.message);
  revalidateMrs(docId);
  return { ok: true };
}

export async function deleteMrsLine(id: string, docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("material_requisition_lines").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateMrs(docId);
  return { ok: true };
}

export async function submitMrs(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("material_requisitions").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Not in draft status");
  const { error } = await s.from("material_requisitions").update({ status: "submitted" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateMrs(id);
  return { ok: true };
}

export async function approveMrs(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("material_requisitions").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "submitted") return bad("Not in submitted status");
  const { error } = await s
    .from("material_requisitions")
    .update({ status: "approved", approved_by: await uid(), approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidateMrs(id);
  return { ok: true };
}

export async function rejectMrs(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("material_requisitions").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "submitted") return bad("Not in submitted status");
  const { error } = await s.from("material_requisitions").update({ status: "rejected" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateMrs(id);
  return { ok: true };
}

/** Approved → issued: post `issue` per line (issued_qty = requested_qty). */
export async function issueMrs(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("material_requisitions").select("status, store_id").eq("id", id).maybeSingle();
  if (!doc || doc.status !== "approved") return bad("Only an approved requisition can be issued");
  const { data: lines } = await s
    .from("material_requisition_lines")
    .select("id, item_id, requested_qty")
    .eq("material_requisition_id", id);
  const ls = (lines ?? []) as { id: string; item_id: string; requested_qty: number }[];
  const err = await postLedger(
    ls.map((l) => ({
      store_id: doc.store_id as string,
      item_id: l.item_id,
      movement_type: "issue" as const,
      quantity: l.requested_qty ?? 0,
      reference_type: "material_requisition",
      reference_id: id,
    })),
  );
  if (err) return err;
  // mark issued_qty = requested_qty on each line
  for (const l of ls) {
    await s.from("material_requisition_lines").update({ issued_qty: l.requested_qty ?? 0 }).eq("id", l.id);
  }
  const { error } = await s.from("material_requisitions").update({ status: "issued" }).eq("id", id);
  if (error) return bad(error.message);
  await writeAudit({ action: "requisition.issued", entityType: "material_requisition", entityId: id });
  revalidateMrs(id);
  return { ok: true };
}

export async function cancelMrs(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("material_requisitions").select("status").eq("id", id).maybeSingle();
  if (!row || row.status === "issued") return bad("An issued requisition cannot be cancelled");
  const { error } = await s.from("material_requisitions").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateMrs(id);
  return { ok: true };
}

export async function deleteMrs(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("material_requisitions").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "cancelled", "rejected"].includes(row.status))
    return bad("Only draft/cancelled/rejected requisitions can be deleted");
  const { error } = await s.from("material_requisitions").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateMrs();
  return { ok: true };
}

// ============================================================================
// Vendor Returns
// ============================================================================
function revalidateVrt(id?: string): void {
  if (id) revalidatePath(`/stores/vendor-returns/${id}`);
  revalidatePath("/stores/vendor-returns");
  revalidatePath("/stores");
}

export async function createVendorReturn(payload: VendorReturnInput): Promise<{ ok: true; id: string } | Err> {
  await guard("create");
  const p = vendorReturnInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("vendor_returns")
    .insert({ ...p.data, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create");
  revalidateVrt(data.id);
  return { ok: true, id: data.id };
}

export async function addVrtLine(docId: string, payload: VendorReturnLineInput): Promise<R> {
  await guard("edit");
  const p = vendorReturnLineInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("vendor_return_lines").insert({ ...p.data, vendor_return_id: docId });
  if (error) return bad(error.message);
  revalidateVrt(docId);
  return { ok: true };
}

export async function deleteVrtLine(id: string, docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("vendor_return_lines").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateVrt(docId);
  return { ok: true };
}

/** Draft → returned: post `issue` per line (return_qty). */
export async function postVendorReturn(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("vendor_returns").select("status, store_id").eq("id", docId).maybeSingle();
  if (!doc || doc.status !== "draft") return bad("Only a draft return can be posted");
  const { data: lines } = await s.from("vendor_return_lines").select("item_id, return_qty").eq("vendor_return_id", docId);
  const err = await postLedger(
    ((lines ?? []) as { item_id: string; return_qty: number }[]).map((l) => ({
      store_id: doc.store_id as string,
      item_id: l.item_id,
      movement_type: "issue" as const,
      quantity: l.return_qty ?? 0,
      reference_type: "vendor_return",
      reference_id: docId,
    })),
  );
  if (err) return err;
  const { error } = await s.from("vendor_returns").update({ status: "returned" }).eq("id", docId);
  if (error) return bad(error.message);
  await writeAudit({ action: "vendor_return.posted", entityType: "vendor_return", entityId: docId });
  revalidateVrt(docId);
  return { ok: true };
}

/** Returned → replaced: post `receipt` per line (replacement_qty). */
export async function recordReplacement(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("vendor_returns").select("status, store_id").eq("id", docId).maybeSingle();
  if (!doc || doc.status !== "returned") return bad("Replacement can only be recorded on a returned document");
  const { data: lines } = await s.from("vendor_return_lines").select("item_id, replacement_qty").eq("vendor_return_id", docId);
  const err = await postLedger(
    ((lines ?? []) as { item_id: string; replacement_qty: number }[]).map((l) => ({
      store_id: doc.store_id as string,
      item_id: l.item_id,
      movement_type: "receipt" as const,
      quantity: l.replacement_qty ?? 0,
      reference_type: "vendor_return_replacement",
      reference_id: docId,
    })),
  );
  if (err) return err;
  const { error } = await s.from("vendor_returns").update({ status: "replaced" }).eq("id", docId);
  if (error) return bad(error.message);
  revalidateVrt(docId);
  return { ok: true };
}

export async function closeVendorReturn(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("vendor_returns").select("status").eq("id", docId).maybeSingle();
  if (!doc || !["returned", "replaced"].includes(doc.status))
    return bad("Only a returned/replaced document can be closed");
  const { error } = await s.from("vendor_returns").update({ status: "closed" }).eq("id", docId);
  if (error) return bad(error.message);
  revalidateVrt(docId);
  return { ok: true };
}

export async function cancelVendorReturn(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("vendor_returns").select("status").eq("id", docId).maybeSingle();
  if (!doc || doc.status !== "draft") return bad("Only a draft return can be cancelled");
  const { error } = await s.from("vendor_returns").update({ status: "cancelled" }).eq("id", docId);
  if (error) return bad(error.message);
  revalidateVrt(docId);
  return { ok: true };
}

export async function deleteVendorReturn(docId: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: doc } = await s.from("vendor_returns").select("status").eq("id", docId).maybeSingle();
  if (!doc || !["draft", "cancelled"].includes(doc.status))
    return bad("Only draft or cancelled documents can be deleted");
  const { error } = await s.from("vendor_returns").delete().eq("id", docId);
  if (error) return bad(error.message);
  revalidateVrt();
  return { ok: true };
}

// ============================================================================
// CSP Receipts
// ============================================================================
function revalidateCsp(id?: string): void {
  if (id) revalidatePath(`/stores/csp-receipts/${id}`);
  revalidatePath("/stores/csp-receipts");
  revalidatePath("/stores");
}

export async function createCspReceipt(payload: CspInput): Promise<{ ok: true; id: string } | Err> {
  await guard("create");
  const p = cspInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("csp_receipts")
    .insert({ ...p.data, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create");
  revalidateCsp(data.id);
  return { ok: true, id: data.id };
}

export async function addCspLine(docId: string, payload: CspLineInput): Promise<R> {
  await guard("edit");
  const p = cspLineInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("csp_receipt_lines").insert({ ...p.data, csp_receipt_id: docId });
  if (error) return bad(error.message);
  revalidateCsp(docId);
  return { ok: true };
}

export async function deleteCspLine(id: string, docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("csp_receipt_lines").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateCsp(docId);
  return { ok: true };
}

export async function postCspReceipt(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("csp_receipts").select("status, store_id").eq("id", docId).maybeSingle();
  if (!doc || doc.status !== "draft") return bad("Only a draft CSP receipt can be posted");
  const { data: lines } = await s.from("csp_receipt_lines").select("item_id, quantity").eq("csp_receipt_id", docId);
  const err = await postLedger(
    ((lines ?? []) as { item_id: string; quantity: number }[]).map((l) => ({
      store_id: doc.store_id as string,
      item_id: l.item_id,
      movement_type: "receipt" as const,
      quantity: l.quantity ?? 0,
      reference_type: "csp_receipt",
      reference_id: docId,
    })),
  );
  if (err) return err;
  const { error } = await s.from("csp_receipts").update({ status: "posted" }).eq("id", docId);
  if (error) return bad(error.message);
  await writeAudit({ action: "csp_receipt.posted", entityType: "csp_receipt", entityId: docId });
  revalidateCsp(docId);
  return { ok: true };
}

export async function cancelCspReceipt(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("csp_receipts").select("status").eq("id", docId).maybeSingle();
  if (!doc || doc.status !== "draft") return bad("Only a draft CSP receipt can be cancelled");
  const { error } = await s.from("csp_receipts").update({ status: "cancelled" }).eq("id", docId);
  if (error) return bad(error.message);
  revalidateCsp(docId);
  return { ok: true };
}

export async function deleteCspReceipt(docId: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: doc } = await s.from("csp_receipts").select("status").eq("id", docId).maybeSingle();
  if (!doc || !["draft", "cancelled"].includes(doc.status))
    return bad("Only draft or cancelled documents can be deleted");
  const { error } = await s.from("csp_receipts").delete().eq("id", docId);
  if (error) return bad(error.message);
  revalidateCsp();
  return { ok: true };
}
