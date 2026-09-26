"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { cancelRun, getRunForSubject } from "@/lib/approvals/service";
import { notifyCurrentApprovers } from "@/lib/approvals/notify";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getFineEvents } from "./fines-service";
import { fineDraftInput, type FineDraftInput, type FineEvent } from "./fines-types";

/**
 * Pay ▸ Fines & Deductions — the write half (0629).
 *
 * EVERY REFUSAL HERE IS ALSO A REFUSAL IN THE DATABASE. The `can()` gates and
 * the Zod parse are courtesies that answer earlier and in the app's words; the
 * lock, the confirmation, the mandatory remarks, the inactive-staff rule and
 * who may approve are enforced by `hr_fine_guard` / `hr_fine_submit` /
 * `hr_fine_apply_decision`, so a stale tab or a hand-written call is refused
 * the same way ("the server refuses even if the screen is bypassed").
 */

type R = { ok: true; id?: string } | { ok: false; error: string };
const bad = (error: string): R => ({ ok: false, error });

const SUBJECT = WORKFLOWS.hr_fine.subjectTable;

function revalidateFines(): void {
  revalidatePath("/hr/fines");
  revalidatePath("/hr/fines/register");
  revalidatePath("/approvals");
  revalidatePath("/hr/payroll", "layout");
}

/** Postgres raises the operator's sentence; PostgREST wraps it. Unwrap. */
function dbMessage(e: { message?: string; code?: string } | null, fallback: string): string {
  if (!e) return fallback;
  if (e.code === "23505") return "A fine for this staff member and incident reference already exists";
  return e.message || fallback;
}

/** Create a draft (no id) or edit one (id). Only a draft can be edited. */
export async function saveFineDraft(id: string | null, payload: FineDraftInput): Promise<R> {
  if (!(await can("hr_payroll", id ? "edit" : "create"))) return bad("Forbidden");
  const p = fineDraftInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const v = p.data;

  const row = {
    staff_id: v.staff_id,
    incident_ref: v.incident_ref,
    incident_date: v.incident_date,
    deduction_month: `${v.deduction_month}-01`,
    deduction_mode: v.deduction_mode,
    // The calculated modes ignore this and the DB derives the figure; a
    // placeholder keeps the NOT NULL column satisfied until the trigger runs.
    fine_amount: v.deduction_mode === "direct" ? Number(v.fine_amount) : 1,
    days_of_pay: v.deduction_mode === "days" ? Number(v.days_of_pay) : null,
    pct_of_gross: v.deduction_mode === "percent" ? Number(v.pct_of_gross) : null,
    remarks: v.remarks,
  };

  const s = await createClient();
  if (id) {
    const { error } = await s.from("hr_staff_fine_deductions").update(row).eq("id", id);
    if (error) return bad(dbMessage(error, "Could not save the fine"));
    revalidateFines();
    return { ok: true, id };
  }
  const { data, error } = await s.from("hr_staff_fine_deductions").insert(row).select("id").single();
  if (error || !data) return bad(dbMessage(error, "Could not save the fine"));
  revalidateFines();
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Submit for MD / HR Manager approval. `confirmed` is the modal's YES — it is
 * passed through to SQL, which refuses `false`, so the friction point cannot be
 * skipped by calling this action directly.
 */
export async function submitFine(id: string, confirmed: boolean): Promise<R> {
  if (!((await can("hr_payroll", "create")) || (await can("hr_payroll", "edit")))) return bad("Forbidden");
  if (!confirmed) return bad("Set the confirmation to YES before submitting");
  const s = await createClient();
  const { data, error } = await s.rpc("hr_fine_submit", { p_fine_id: id, p_confirmed: confirmed });
  if (error) return bad(dbMessage(error, "Could not submit the fine"));
  const runId = data as string;
  // Approvers are told after the response — the run is already live.
  after(() => notifyCurrentApprovers(runId, { reason: "started" }));
  revalidateFines();
  return { ok: true, id };
}

/**
 * ABANDON ("gave up"). A draft is abandoned directly; a pending fine is
 * abandoned by cancelling its approval run, which the engine's terminal trigger
 * turns into `abandoned` — the one road out of `pending`. Either way the row is
 * kept for the audit and never counted by payroll.
 */
export async function abandonFine(id: string, reason: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  if (!reason.trim()) return bad("Say why the fine is being abandoned");
  const s = await createClient();
  const { data: row, error: readErr } = await s
    .from("hr_staff_fine_deductions")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return bad(readErr.message);
  if (!row) return bad("Fine not found");
  const status = (row as { status: string }).status;

  if (status === "draft") {
    const { error } = await s
      .from("hr_staff_fine_deductions")
      .update({ status: "abandoned", decision_remark: reason.trim().toUpperCase() })
      .eq("id", id);
    if (error) return bad(dbMessage(error, "Could not abandon the fine"));
  } else if (status === "pending") {
    try {
      const run = await getRunForSubject(SUBJECT, id);
      if (!run || run.status !== "in_progress") return bad("This fine has no open approval to withdraw — reload");
      await cancelRun(run.id, reason.trim());
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Could not withdraw the approval");
    }
  } else {
    return bad(`This fine is ${status} and can no longer be abandoned`);
  }
  revalidateFines();
  return { ok: true };
}

/** Delete a draft that was never submitted. The log keeps a `draft_deleted` line. */
export async function deleteFineDraft(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("hr_staff_fine_deductions").delete().eq("id", id);
  if (error) return bad(dbMessage(error, "Could not delete the fine"));
  revalidateFines();
  return { ok: true };
}

/** What the record sheet shows beside the fine: its audit log and approval. */
export async function loadFineDetail(id: string): Promise<{
  events: FineEvent[];
  panel: Awaited<ReturnType<typeof getApprovalPanel>>;
}> {
  const [events, panel] = await Promise.all([
    getFineEvents(id).catch(() => [] as FineEvent[]),
    getApprovalPanel(SUBJECT, id),
  ]);
  return { events, panel };
}
