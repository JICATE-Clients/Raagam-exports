"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  workTypeInput,
  sewingOperationInput,
  jobOrderInput,
  jobOrderComponentInput,
  pieceRateInput,
  packingListInput,
  packingLineInput,
  inspectionInput,
  despatchInput,
} from "./extras-types";
import type {
  WorkTypeInput,
  SewingOperationInput,
  JobOrderInput,
  JobOrderComponentInput,
  PieceRateInput,
  PackingListInput,
  PackingLineInput,
  InspectionInput,
  DespatchInput,
  InspectionResult,
} from "./extras-types";

type Err = { ok: false; error: string };
type Ok = { ok: true };
type R = Ok | Err;

async function guard(action: "create" | "edit" | "delete" | "approve"): Promise<void> {
  if (!(await can("production", action))) throw new Error("Forbidden");
}
async function uid(): Promise<string | null> {
  const u = await getAppUser();
  return u?.id ?? null;
}
function bad(m: string): Err {
  return { ok: false, error: m };
}

// ============================================================================
// Masters — Work Types & Sewing Operations
// ============================================================================
function revalidateMasters(): void {
  revalidatePath("/production/masters");
  revalidatePath("/production");
}

export async function createWorkType(payload: WorkTypeInput): Promise<R> {
  await guard("create");
  const p = workTypeInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("work_types").insert(p.data);
  if (error) return bad(error.message);
  revalidateMasters();
  return { ok: true };
}
export async function deleteWorkType(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("work_types").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateMasters();
  return { ok: true };
}
export async function createSewingOperation(payload: SewingOperationInput): Promise<R> {
  await guard("create");
  const p = sewingOperationInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("sewing_operations").insert(p.data);
  if (error) return bad(error.message);
  revalidateMasters();
  return { ok: true };
}
export async function deleteSewingOperation(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("sewing_operations").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateMasters();
  return { ok: true };
}

// ============================================================================
// Job Orders
// ============================================================================
function revalidateJob(id?: string): void {
  if (id) revalidatePath(`/production/job-orders/${id}`);
  revalidatePath("/production/job-orders");
  revalidatePath("/production");
}

export async function createJobOrder(payload: JobOrderInput): Promise<{ ok: true; id: string } | Err> {
  await guard("create");
  const p = jobOrderInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("production_job_orders")
    .insert({ ...p.data, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create");
  revalidateJob(data.id);
  return { ok: true, id: data.id };
}
export async function addJobComponent(jobId: string, payload: JobOrderComponentInput): Promise<R> {
  await guard("edit");
  const p = jobOrderComponentInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("job_order_components").insert({ ...p.data, job_order_id: jobId });
  if (error) return bad(error.message);
  revalidateJob(jobId);
  return { ok: true };
}
export async function deleteJobComponent(id: string, jobId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("job_order_components").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateJob(jobId);
  return { ok: true };
}
async function setJobStatus(id: string, to: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.from("production_job_orders").update({ status: to }).eq("id", id);
  if (error) return bad(error.message);
  revalidateJob(id);
  return { ok: true };
}
export async function openJobOrder(id: string): Promise<R> {
  await guard("edit");
  return setJobStatus(id, "open");
}
export async function completeJobOrder(id: string): Promise<R> {
  await guard("edit");
  return setJobStatus(id, "completed");
}
export async function cancelJobOrder(id: string): Promise<R> {
  await guard("edit");
  return setJobStatus(id, "cancelled");
}
export async function deleteJobOrder(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("production_job_orders").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "cancelled"].includes(row.status))
    return bad("Only draft or cancelled job orders can be deleted");
  const { error } = await s.from("production_job_orders").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateJob();
  return { ok: true };
}

// ============================================================================
// Contractor Piece Rates
// ============================================================================
function revalidatePR(): void {
  revalidatePath("/production/piece-rates");
  revalidatePath("/production");
}

export async function createPieceRate(payload: PieceRateInput): Promise<R> {
  await guard("create");
  const p = pieceRateInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("contractor_piece_rates").insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revalidatePR();
  return { ok: true };
}
export async function submitPieceRate(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("contractor_piece_rates").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Not in draft status");
  const { error } = await s.from("contractor_piece_rates").update({ status: "submitted" }).eq("id", id);
  if (error) return bad(error.message);
  revalidatePR();
  return { ok: true };
}
export async function approvePieceRate(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("contractor_piece_rates").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "submitted") return bad("Not in submitted status");
  const { error } = await s
    .from("contractor_piece_rates")
    .update({ status: "approved", approved_by: await uid(), approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return bad(error.message);
  await writeAudit({ action: "piece_rate.approved", entityType: "contractor_piece_rate", entityId: id });
  revalidatePR();
  return { ok: true };
}
export async function rejectPieceRate(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("contractor_piece_rates").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "submitted") return bad("Not in submitted status");
  const { error } = await s.from("contractor_piece_rates").update({ status: "rejected" }).eq("id", id);
  if (error) return bad(error.message);
  revalidatePR();
  return { ok: true };
}
export async function deletePieceRate(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("contractor_piece_rates").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "rejected"].includes(row.status))
    return bad("Only draft or rejected rates can be deleted");
  const { error } = await s.from("contractor_piece_rates").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidatePR();
  return { ok: true };
}

// ============================================================================
// Packing Lists
// ============================================================================
function revalidatePkl(id?: string): void {
  if (id) revalidatePath(`/production/packing-lists/${id}`);
  revalidatePath("/production/packing-lists");
  revalidatePath("/production");
}

export async function createPackingList(payload: PackingListInput): Promise<{ ok: true; id: string } | Err> {
  await guard("create");
  const p = packingListInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("packing_lists")
    .insert({ ...p.data, status: "draft", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create");
  revalidatePkl(data.id);
  return { ok: true, id: data.id };
}
export async function addPackingLine(docId: string, payload: PackingLineInput): Promise<R> {
  await guard("edit");
  const p = packingLineInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("packing_list_lines").insert({ ...p.data, packing_list_id: docId });
  if (error) return bad(error.message);
  revalidatePkl(docId);
  return { ok: true };
}
export async function deletePackingLine(id: string, docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("packing_list_lines").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidatePkl(docId);
  return { ok: true };
}
export async function finalizePackingList(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: doc } = await s.from("packing_lists").select("status").eq("id", docId).maybeSingle();
  if (!doc || doc.status !== "draft") return bad("Only a draft packing list can be finalized");
  const { error } = await s.from("packing_lists").update({ status: "finalized" }).eq("id", docId);
  if (error) return bad(error.message);
  revalidatePkl(docId);
  return { ok: true };
}
export async function cancelPackingList(docId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("packing_lists").update({ status: "cancelled" }).eq("id", docId);
  if (error) return bad(error.message);
  revalidatePkl(docId);
  return { ok: true };
}
export async function deletePackingList(docId: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: doc } = await s.from("packing_lists").select("status").eq("id", docId).maybeSingle();
  if (!doc || !["draft", "cancelled"].includes(doc.status))
    return bad("Only draft or cancelled packing lists can be deleted");
  const { error } = await s.from("packing_lists").delete().eq("id", docId);
  if (error) return bad(error.message);
  revalidatePkl();
  return { ok: true };
}

// ============================================================================
// Inspections
// ============================================================================
function revalidateIns(): void {
  revalidatePath("/production/inspections");
  revalidatePath("/production");
}

export async function createInspection(payload: InspectionInput): Promise<R> {
  await guard("create");
  const p = inspectionInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s
    .from("inspections")
    .insert({ ...p.data, result: "pending", status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revalidateIns();
  return { ok: true };
}
export async function recordInspectionResult(id: string, result: InspectionResult): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("inspections").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Result can only be recorded on a draft inspection");
  const { error } = await s.from("inspections").update({ result, status: "completed" }).eq("id", id);
  if (error) return bad(error.message);
  await writeAudit({ action: "inspection.completed", entityType: "inspection", entityId: id, metadata: { result } });
  revalidateIns();
  return { ok: true };
}
export async function cancelInspection(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("inspections").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateIns();
  return { ok: true };
}
export async function deleteInspection(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("inspections").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "cancelled"].includes(row.status))
    return bad("Only draft or cancelled inspections can be deleted");
  const { error } = await s.from("inspections").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateIns();
  return { ok: true };
}

// ============================================================================
// Despatches
// ============================================================================
function revalidateDsp(): void {
  revalidatePath("/production/despatch");
  revalidatePath("/production");
}

export async function createDespatch(payload: DespatchInput): Promise<R> {
  await guard("create");
  const p = despatchInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("despatches").insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revalidateDsp();
  return { ok: true };
}
export async function markDespatched(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("despatches").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Only a draft despatch can be marked despatched");
  const { error } = await s.from("despatches").update({ status: "despatched" }).eq("id", id);
  if (error) return bad(error.message);
  await writeAudit({ action: "despatch.despatched", entityType: "despatch", entityId: id });
  revalidateDsp();
  return { ok: true };
}
export async function cancelDespatch(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("despatches").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidateDsp();
  return { ok: true };
}
export async function deleteDespatch(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("despatches").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "cancelled"].includes(row.status))
    return bad("Only draft or cancelled despatches can be deleted");
  const { error } = await s.from("despatches").delete().eq("id", id);
  if (error) return bad(error.message);
  revalidateDsp();
  return { ok: true };
}
