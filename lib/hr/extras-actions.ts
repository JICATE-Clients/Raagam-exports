"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  advanceInput,
  adjustmentInput,
  compEventInput,
  leaveInput,
  lifecycleInput,
  statutoryInput,
} from "./extras-types";
import type {
  AdvanceInput,
  AdjustmentInput,
  CompEventInput,
  LeaveInput,
  LifecycleInput,
  StatutoryInput,
} from "./extras-types";

type Err = { ok: false; error: string };
type Ok = { ok: true };
type R = Ok | Err;

async function guard(action: "create" | "edit" | "delete" | "approve"): Promise<void> {
  if (!(await can("hr_payroll", action))) throw new Error("Forbidden");
}
async function uid(): Promise<string | null> {
  const u = await getAppUser();
  return u?.id ?? null;
}
function bad(m: string): Err {
  return { ok: false, error: m };
}

// ============================================================================
// Advances
// ============================================================================
function revA(): void {
  revalidatePath("/hr/advances");
  revalidatePath("/hr");
}
export async function createAdvance(payload: AdvanceInput): Promise<R> {
  await guard("create");
  const p = advanceInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("hr_advances").insert({ ...p.data, repaid_amount: 0, status: "open", created_by: await uid() });
  if (error) return bad(error.message);
  revA();
  return { ok: true };
}
export async function recordRepayment(id: string, amount: number): Promise<R> {
  await guard("edit");
  if (!(amount > 0)) return bad("Repayment amount must be greater than zero");
  const s = await createClient();
  const { data: row } = await s.from("hr_advances").select("amount, repaid_amount, status").eq("id", id).maybeSingle();
  if (!row || ["closed", "cancelled"].includes(row.status)) return bad("Advance is not open");
  const newRepaid = (row.repaid_amount as number) + amount;
  const status = newRepaid >= (row.amount as number) ? "closed" : "repaying";
  const { error } = await s.from("hr_advances").update({ repaid_amount: newRepaid, status }).eq("id", id);
  if (error) return bad(error.message);
  revA();
  return { ok: true };
}
export async function cancelAdvance(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("hr_advances").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revA();
  return { ok: true };
}
export async function deleteAdvance(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("hr_advances").select("status").eq("id", id).maybeSingle();
  if (!row || !["open", "cancelled"].includes(row.status)) return bad("Only open or cancelled advances can be deleted");
  const { error } = await s.from("hr_advances").delete().eq("id", id);
  if (error) return bad(error.message);
  revA();
  return { ok: true };
}

// ============================================================================
// Allowances & Deductions
// ============================================================================
function revAdj(): void {
  revalidatePath("/hr/adjustments");
  revalidatePath("/hr");
}
export async function createAdjustment(payload: AdjustmentInput): Promise<R> {
  await guard("create");
  const p = adjustmentInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("hr_adjustments").insert({ ...p.data, status: "active", created_by: await uid() });
  if (error) return bad(error.message);
  revAdj();
  return { ok: true };
}
export async function endAdjustment(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("hr_adjustments").update({ status: "ended" }).eq("id", id);
  if (error) return bad(error.message);
  revAdj();
  return { ok: true };
}
export async function deleteAdjustment(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("hr_adjustments").delete().eq("id", id);
  if (error) return bad(error.message);
  revAdj();
  return { ok: true };
}

// ============================================================================
// Bonus & Increments
// ============================================================================
function revC(): void {
  revalidatePath("/hr/comp-events");
  revalidatePath("/hr");
}
export async function createCompEvent(payload: CompEventInput): Promise<R> {
  await guard("create");
  const p = compEventInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("hr_comp_events").insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
export async function approveCompEvent(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("hr_comp_events").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Not in draft status");
  const { error } = await s
    .from("hr_comp_events")
    .update({ status: "approved", approved_by: await uid(), approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return bad(error.message);
  await writeAudit({ action: "hr_comp_event.approved", entityType: "hr_comp_event", entityId: id });
  revC();
  return { ok: true };
}
export async function rejectCompEvent(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("hr_comp_events").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Not in draft status");
  const { error } = await s.from("hr_comp_events").update({ status: "rejected" }).eq("id", id);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
export async function deleteCompEvent(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("hr_comp_events").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "rejected"].includes(row.status)) return bad("Only draft or rejected events can be deleted");
  const { error } = await s.from("hr_comp_events").delete().eq("id", id);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}

// ============================================================================
// Leave & Encashment
// ============================================================================
function revL(): void {
  revalidatePath("/hr/leave");
  revalidatePath("/hr");
}
export async function createLeave(payload: LeaveInput): Promise<R> {
  await guard("create");
  const p = leaveInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("hr_leaves").insert({ ...p.data, status: "pending", created_by: await uid() });
  if (error) return bad(error.message);
  revL();
  return { ok: true };
}
export async function approveLeave(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("hr_leaves").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "pending") return bad("Not in pending status");
  const { error } = await s
    .from("hr_leaves")
    .update({ status: "approved", approved_by: await uid(), approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return bad(error.message);
  revL();
  return { ok: true };
}
export async function rejectLeave(id: string): Promise<R> {
  await guard("approve");
  const s = await createClient();
  const { data: row } = await s.from("hr_leaves").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "pending") return bad("Not in pending status");
  const { error } = await s.from("hr_leaves").update({ status: "rejected" }).eq("id", id);
  if (error) return bad(error.message);
  revL();
  return { ok: true };
}
export async function cancelLeave(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("hr_leaves").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revL();
  return { ok: true };
}
export async function deleteLeave(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("hr_leaves").select("status").eq("id", id).maybeSingle();
  if (!row || !["pending", "cancelled", "rejected"].includes(row.status)) return bad("Only pending/cancelled/rejected leaves can be deleted");
  const { error } = await s.from("hr_leaves").delete().eq("id", id);
  if (error) return bad(error.message);
  revL();
  return { ok: true };
}

// ============================================================================
// Lifecycle events
// ============================================================================
function revLce(): void {
  revalidatePath("/hr/lifecycle");
  revalidatePath("/hr");
}
export async function createLifecycle(payload: LifecycleInput): Promise<R> {
  await guard("create");
  const p = lifecycleInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("hr_lifecycle_events").insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revLce();
  return { ok: true };
}
export async function completeLifecycle(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("hr_lifecycle_events").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Not in draft status");
  const { error } = await s.from("hr_lifecycle_events").update({ status: "completed" }).eq("id", id);
  if (error) return bad(error.message);
  await writeAudit({ action: "hr_lifecycle.completed", entityType: "hr_lifecycle_event", entityId: id });
  revLce();
  return { ok: true };
}
export async function cancelLifecycle(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("hr_lifecycle_events").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revLce();
  return { ok: true };
}
export async function deleteLifecycle(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("hr_lifecycle_events").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "cancelled"].includes(row.status)) return bad("Only draft or cancelled events can be deleted");
  const { error } = await s.from("hr_lifecycle_events").delete().eq("id", id);
  if (error) return bad(error.message);
  revLce();
  return { ok: true };
}

// ============================================================================
// Statutory documents
// ============================================================================
function revS(): void {
  revalidatePath("/hr/statutory");
  revalidatePath("/hr");
}
export async function createStatutory(payload: StatutoryInput): Promise<R> {
  await guard("create");
  const p = statutoryInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("hr_statutory_docs").insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revS();
  return { ok: true };
}
export async function fileStatutory(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("hr_statutory_docs").update({ status: "filed" }).eq("id", id);
  if (error) return bad(error.message);
  revS();
  return { ok: true };
}
export async function deleteStatutory(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("hr_statutory_docs").delete().eq("id", id);
  if (error) return bad(error.message);
  revS();
  return { ok: true };
}
