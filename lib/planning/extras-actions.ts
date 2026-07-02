"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import {
  sqNoteInput,
  sqAllocationInput,
  iwoBomItemInput,
  processAllocationInput,
  materialExcessInput,
  ppmIssueInput,
  ppmLineInput,
  stockCompletionInput,
  pdRequestInput,
  pdProductInput,
  nextPdStage,
} from "./types";
import type {
  SqNoteInput,
  SqAllocationInput,
  IwoBomItemInput,
  ProcessAllocationInput,
  MaterialExcessInput,
  PpmIssueInput,
  PpmLineInput,
  StockCompletionInput,
  PdRequestInput,
  PdProductInput,
  PdStage,
} from "./types";

type Err = { ok: false; error: string };
type Ok = { ok: true };
type R = Ok | Err;

async function guard(action: "create" | "edit" | "delete" | "approve"): Promise<void> {
  if (!(await can("planning", action))) throw new Error("Forbidden");
}
async function uid(): Promise<string | null> {
  const u = await getAppUser();
  return u?.id ?? null;
}
function bad(msg: string): Err {
  return { ok: false, error: msg };
}

// ============================================================================
// SQ Notes & Allocation
// ============================================================================
function revalidateSq(id?: string): void {
  if (id) revalidatePath(`/planning/sq-notes/${id}`);
  revalidatePath("/planning/sq-notes");
  revalidatePath("/planning");
}

export async function createSqNote(
  payload: SqNoteInput,
): Promise<{ ok: true; sqNoteId: string } | Err> {
  await guard("create");
  const p = sqNoteInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("sq_notes")
    .insert({ ...p.data, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create SQ note");
  revalidateSq(data.id);
  return { ok: true, sqNoteId: data.id };
}

export async function addSqAllocation(
  sqNoteId: string,
  payload: SqAllocationInput,
): Promise<R> {
  await guard("edit");
  const p = sqAllocationInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s
    .from("sq_allocations")
    .insert({ ...p.data, sq_note_id: sqNoteId });
  if (error) return bad(error.message);
  revalidateSq(sqNoteId);
  return { ok: true };
}

export async function deleteSqAllocation(id: string, sqNoteId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("sq_allocations").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateSq(sqNoteId);
  return { ok: true };
}

export async function allocateSqNote(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { count } = await s
    .from("sq_allocations")
    .select("id", { count: "exact", head: true })
    .eq("sq_note_id", id);
  if (!count || count < 1) return bad("Add at least one allocation line first");
  const { error } = await s.from("sq_notes").update({ status: "allocated" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateSq(id);
  return { ok: true };
}

export async function cancelSqNote(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("sq_notes").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateSq(id);
  return { ok: true };
}

export async function deleteSqNote(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("sq_notes").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "cancelled"].includes(row.status))
    return bad("Only draft or cancelled SQ notes can be deleted");
  const { error } = await s.from("sq_notes").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateSq();
  return { ok: true };
}

// ============================================================================
// BOM for Internal Work Orders
// ============================================================================
function revalidateIwoBom(iwoId: string): void {
  revalidatePath(`/planning/iwo-boms/${iwoId}`);
  revalidatePath("/planning/iwo-boms");
  revalidatePath("/planning");
}

/** Ensure a bom row exists for the IWO, returning its id. */
async function ensureIwoBom(iwoId: string): Promise<string | null> {
  const s = await createClient();
  const { data: existing } = await s
    .from("iwo_boms")
    .select("id")
    .eq("iwo_id", iwoId)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await s
    .from("iwo_boms")
    .insert({ iwo_id: iwoId, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id as string;
}

export async function addIwoBomItem(iwoId: string, payload: IwoBomItemInput): Promise<R> {
  await guard("edit");
  const p = iwoBomItemInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const bomId = await ensureIwoBom(iwoId);
  if (!bomId) return bad("Could not create BOM for this work order");
  const s = await createClient();
  const { error } = await s.from("iwo_bom_items").insert({ ...p.data, iwo_bom_id: bomId });
  if (error) return bad(error.message);
  revalidateIwoBom(iwoId);
  return { ok: true };
}

export async function deleteIwoBomItem(itemId: string, iwoId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("iwo_bom_items").delete().eq("id", itemId);
  if (error) return bad(error.message);
  revalidateIwoBom(iwoId);
  return { ok: true };
}

export async function finalizeIwoBom(iwoId: string): Promise<R> {
  await guard("edit");
  const bomId = await ensureIwoBom(iwoId);
  if (!bomId) return bad("No BOM to finalize");
  const s = await createClient();
  const { error } = await s.from("iwo_boms").update({ status: "final" }).eq("id", bomId);
  if (error) return bad(error.message);
  revalidateIwoBom(iwoId);
  return { ok: true };
}

// ============================================================================
// Purchase Process Allocation
// ============================================================================
function revalidatePA(): void {
  revalidatePath("/planning/process-allocations");
  revalidatePath("/planning");
}

export async function createProcessAllocation(
  payload: ProcessAllocationInput,
): Promise<R> {
  await guard("create");
  const p = processAllocationInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s
    .from("process_allocations")
    .insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revalidatePA();
  return { ok: true };
}

export async function confirmProcessAllocation(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s
    .from("process_allocations")
    .update({ status: "confirmed" })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidatePA();
  return { ok: true };
}

export async function cancelProcessAllocation(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s
    .from("process_allocations")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidatePA();
  return { ok: true };
}

export async function deleteProcessAllocation(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("process_allocations").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidatePA();
  return { ok: true };
}

// ============================================================================
// Material Excess Order & Receipt
// ============================================================================
function revalidateME(): void {
  revalidatePath("/planning/material-excess");
  revalidatePath("/planning");
}

export async function createMaterialExcess(payload: MaterialExcessInput): Promise<R> {
  await guard("create");
  const p = materialExcessInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s
    .from("material_excess")
    .insert({ ...p.data, received_qty: 0, status: "open", created_by: await uid() });
  if (error) return bad(error.message);
  revalidateME();
  return { ok: true };
}

export async function receiveMaterialExcess(id: string, receivedQty: number): Promise<R> {
  await guard("edit");
  if (!(receivedQty >= 0)) return bad("Received qty must be zero or more");
  const s = await createClient();
  const { error } = await s
    .from("material_excess")
    .update({ received_qty: receivedQty, status: "received" })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidateME();
  return { ok: true };
}

export async function closeMaterialExcess(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("material_excess").update({ status: "closed" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateME();
  return { ok: true };
}

export async function cancelMaterialExcess(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s
    .from("material_excess")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidateME();
  return { ok: true };
}

export async function deleteMaterialExcess(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s
    .from("material_excess")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row || !["open", "cancelled"].includes(row.status))
    return bad("Only open or cancelled entries can be deleted");
  const { error } = await s.from("material_excess").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateME();
  return { ok: true };
}

// ============================================================================
// Issue PPM
// ============================================================================
function revalidatePpm(id?: string): void {
  if (id) revalidatePath(`/planning/ppm/${id}`);
  revalidatePath("/planning/ppm");
  revalidatePath("/planning");
}

export async function createPpmIssue(
  payload: PpmIssueInput,
): Promise<{ ok: true; ppmId: string } | Err> {
  await guard("create");
  const p = ppmIssueInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("ppm_issues")
    .insert({ ...p.data, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create PPM");
  revalidatePpm(data.id);
  return { ok: true, ppmId: data.id };
}

export async function addPpmLine(ppmId: string, payload: PpmLineInput): Promise<R> {
  await guard("edit");
  const p = ppmLineInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s
    .from("ppm_issue_lines")
    .insert({ ...p.data, received_qty: 0, ppm_issue_id: ppmId });
  if (error) return bad(error.message);
  revalidatePpm(ppmId);
  return { ok: true };
}

export async function updatePpmLineReceipt(
  lineId: string,
  ppmId: string,
  receivedQty: number,
): Promise<R> {
  await guard("edit");
  if (!(receivedQty >= 0)) return bad("Received qty must be zero or more");
  const s = await createClient();
  const { error } = await s
    .from("ppm_issue_lines")
    .update({ received_qty: receivedQty })
    .eq("id", lineId);
  if (error) return bad(error.message);
  revalidatePpm(ppmId);
  return { ok: true };
}

export async function deletePpmLine(id: string, ppmId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("ppm_issue_lines").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidatePpm(ppmId);
  return { ok: true };
}

export async function issuePpm(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { count } = await s
    .from("ppm_issue_lines")
    .select("id", { count: "exact", head: true })
    .eq("ppm_issue_id", id);
  if (!count || count < 1) return bad("Add at least one line before issuing");
  const { error } = await s.from("ppm_issues").update({ status: "issued" }).eq("id", id);
  if (error) return bad(error.message);
  revalidatePpm(id);
  return { ok: true };
}

export async function receivePpm(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("ppm_issues").update({ status: "received" }).eq("id", id);
  if (error) return bad(error.message);
  revalidatePpm(id);
  return { ok: true };
}

export async function cancelPpm(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("ppm_issues").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidatePpm(id);
  return { ok: true };
}

export async function deletePpm(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("ppm_issues").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "cancelled"].includes(row.status))
    return bad("Only draft or cancelled PPMs can be deleted");
  const { error } = await s.from("ppm_issues").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidatePpm();
  return { ok: true };
}

// ============================================================================
// Stock Completion
// ============================================================================
function revalidateSC(): void {
  revalidatePath("/planning/stock-completion");
  revalidatePath("/planning");
}

export async function createStockCompletion(payload: StockCompletionInput): Promise<R> {
  await guard("create");
  const p = stockCompletionInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s
    .from("stock_completions")
    .insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revalidateSC();
  return { ok: true };
}

export async function completeStockCompletion(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s
    .from("stock_completions")
    .update({ status: "completed" })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidateSC();
  return { ok: true };
}

export async function cancelStockCompletion(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s
    .from("stock_completions")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return bad(error.message);
  revalidateSC();
  return { ok: true };
}

export async function deleteStockCompletion(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("stock_completions").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateSC();
  return { ok: true };
}

// ============================================================================
// Product Development Pipeline
// ============================================================================
function revalidatePd(id?: string): void {
  if (id) revalidatePath(`/planning/product-dev/${id}`);
  revalidatePath("/planning/product-dev");
  revalidatePath("/planning");
}

export async function createPdRequest(
  payload: PdRequestInput,
): Promise<{ ok: true; pdId: string } | Err> {
  await guard("create");
  const p = pdRequestInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("pd_requests")
    .insert({ ...p.data, stage: "acknowledged", status: "open", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create PD request");
  revalidatePd(data.id);
  return { ok: true, pdId: data.id };
}

export async function addPdProduct(pdId: string, payload: PdProductInput): Promise<R> {
  await guard("edit");
  const p = pdProductInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("pd_products").insert({ ...p.data, pd_request_id: pdId });
  if (error) return bad(error.message);
  revalidatePd(pdId);
  return { ok: true };
}

export async function deletePdProduct(id: string, pdId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("pd_products").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidatePd(pdId);
  return { ok: true };
}

export async function advancePdStage(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("pd_requests").select("stage, status").eq("id", id).maybeSingle();
  if (!row) return bad("PD request not found");
  if (row.status !== "open") return bad("Only open PD requests can advance");
  const next = nextPdStage(row.stage as PdStage);
  if (!next) return bad("Already at the final stage");
  const { error } = await s.from("pd_requests").update({ stage: next }).eq("id", id);
  if (error) return bad(error.message);
  revalidatePd(id);
  return { ok: true };
}

export async function closePdRequest(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("pd_requests").update({ status: "closed" }).eq("id", id);
  if (error) return bad(error.message);
  revalidatePd(id);
  return { ok: true };
}

export async function cancelPdRequest(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("pd_requests").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidatePd(id);
  return { ok: true };
}

export async function deletePdRequest(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("pd_requests").select("status").eq("id", id).maybeSingle();
  if (!row || !["open", "cancelled"].includes(row.status))
    return bad("Only open or cancelled PD requests can be deleted");
  const { error } = await s.from("pd_requests").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidatePd();
  return { ok: true };
}
