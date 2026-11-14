"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getRunForSubject } from "@/lib/approvals/service";
import { notifyCurrentApprovers } from "@/lib/approvals/notify";
import { getApprovalPanel, actOnSubject } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { currentYearId, getBalanceSheet } from "./timeoff-service";
import {
  applyInput,
  blackoutInput,
  entitlementInput,
  leaveTypeInput,
  splitPersonKey,
  yearInput,
  TIMEOFF_FILE_BUCKET,
  type ApplyInput,
  type BalanceRow,
  type BlackoutInput,
  type EntitlementInput,
  type LeaveTypeInput,
  type YearInput,
} from "./timeoff-types";

/**
 * HR ▸ Time Off (0770) — the write half.
 *
 * Requests, claims and encashments are written ONLY by the SECURITY DEFINER
 * functions in 0770, which hold every rule (balance, overlap, notice, caps,
 * who may act for whom). The actions here pass the operator's input through
 * and turn the database's sentence into a toast. The catalogs (types, years,
 * blackouts, entitlement overrides) are plain table writes under RLS.
 */

type R = { ok: true; id?: string; count?: number; warning?: string } | { ok: false; error: string };
const bad = (error: string): R => ({ ok: false, error });

function dbMessage(e: { message?: string; code?: string } | null, fallback: string): string {
  if (!e) return fallback;
  if (e.code === "23505") return "That already exists";
  return e.message || fallback;
}

function revalidateTimeoff(): void {
  revalidatePath("/hr/time-off", "layout");
  revalidatePath("/approvals");
}

/** Tell the current step's approvers, after the response — the run is live. */
function notifyStarted(table: string, id: string): void {
  after(async () => {
    const run = await getRunForSubject(table, id).catch(() => null);
    if (run) await notifyCurrentApprovers(run.id, { reason: "started" });
  });
}

// ─── Requests ──────────────────────────────────────────────────────────────

/**
 * `file` is an upload the browser has already put in the private bucket
 * (0843, On Duty). It is linked once the request exists; an apply the
 * database refuses removes it again, so nothing is left orphaned.
 */
export async function applyTimeoff(payload: ApplyInput, file?: { path: string; name: string } | null): Promise<R> {
  const p = applyInput.safeParse(payload);
  if (!p.success) {
    if (file) await discardTimeoffFile(file.path);
    return bad(p.error.issues[0]?.message ?? "Invalid input");
  }
  const v = p.data;
  const who = splitPersonKey(v.person);
  const s = await createClient();
  const { data, error } = await s.rpc("timeoff_apply", {
    p_staff_id: who.staff_id,
    p_worker_id: who.worker_id,
    p_leave_type_id: v.leave_type_id,
    p_start: v.start_date,
    p_end: v.end_date,
    p_day_part: v.day_part,
    p_start_time: v.day_part === "hourly" ? v.start_time : null,
    p_end_time: v.day_part === "hourly" ? v.end_time : null,
    p_reason: v.reason,
  });
  if (error) {
    if (file) await s.storage.from(TIMEOFF_FILE_BUCKET).remove([file.path]);
    return bad(dbMessage(error, "Could not apply"));
  }
  const id = data as string;
  let warning: string | undefined;
  if (file) {
    const at = await s.rpc("timeoff_attach_file", { p_id: id, p_path: file.path, p_name: file.name });
    if (at.error) {
      await s.storage.from(TIMEOFF_FILE_BUCKET).remove([file.path]);
      warning = `Applied, but the file was not attached — ${dbMessage(at.error, "it could not be linked")}`;
    }
  }
  notifyStarted(WORKFLOWS.timeoff_request.subjectTable, id);
  revalidateTimeoff();
  return { ok: true, id, warning };
}

/** An upload abandoned before it was linked (the sheet was cancelled). */
export async function discardTimeoffFile(path: string): Promise<void> {
  const s = await createClient();
  await s.storage.from(TIMEOFF_FILE_BUCKET).remove([path]);
}

/** A short-lived link to a request's attached file — RLS decides who may read it. */
export async function timeoffFileLink(path: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const s = await createClient();
  const { data, error } = await s.storage.from(TIMEOFF_FILE_BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return { ok: false, error: "The file could not be opened" };
  return { ok: true, url: data.signedUrl };
}

export async function withdrawTimeoff(kind: "request" | "encashment", id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why it is being withdrawn");
  const table = kind === "request" ? WORKFLOWS.timeoff_request.subjectTable : WORKFLOWS.timeoff_encashment.subjectTable;
  const s = await createClient();
  const { error } = await s.rpc("timeoff_withdraw", { p_table: table, p_id: id, p_reason: reason });
  if (error) return bad(dbMessage(error, "Could not withdraw"));
  revalidateTimeoff();
  return { ok: true };
}

/** Cancel (own, approved, not yet started) or revoke (HR, approved). */
export async function closeApprovedTimeoff(id: string, mode: "cancel" | "revoke", reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("timeoff_close_approved", { p_id: id, p_mode: mode, p_reason: reason });
  if (error) return bad(dbMessage(error, mode === "cancel" ? "Could not cancel" : "Could not revoke"));
  revalidateTimeoff();
  return { ok: true };
}

/** The person's balances this leave year — the apply sheet's "available" line. */
export async function loadPersonBalances(person: string): Promise<BalanceRow[]> {
  if (!person) return [];
  const yearId = await currentYearId();
  if (!yearId) return [];
  return getBalanceSheet(yearId, splitPersonKey(person)).catch(() => []);
}

/** The approval panel for one request, encashment or comp-off claim. */
export async function loadTimeoffPanel(kind: "request" | "encashment" | "claim", id: string) {
  const panel = await getApprovalPanel(subjectTableOf(kind), id);
  // Who the open step waits for, by name (0818) — "SURESH", not "the HOD".
  let waiting: string[] = [];
  let next: string | null = null;
  if (panel.run?.status === "in_progress") {
    const s = await createClient();
    const { data, error } = await s.rpc("hr_waiting_on", { p_run_id: panel.run.id });
    if (!error) waiting = ((data ?? []) as { full_name: string | null }[]).map((n) => n.full_name ?? "").filter(Boolean);
    next = await hrNextStage(panel.run.id);
  }
  return { ...panel, waiting, next };
}

/**
 * Where "Send to …" would take this request for the caller (0821) — the first
 * later stage with someone on it who is not them, or null when there is none
 * or the caller cannot decide it. The button's label and the send read the
 * same database answer, so the label is where the request lands.
 */
export async function hrNextStage(runId: string): Promise<string | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("hr_approval_next_stage", { p_run_id: runId });
  if (error) return null; // PGRST202 before 0821 — no button rather than a wrong one
  return ((data ?? []) as { step_label: string | null }[])[0]?.step_label ?? null;
}

/**
 * Approve / reject from the Time Off queue — one item or many. Every kind goes
 * through the engine (the step's own approver, its comment rules, its
 * notifications); comp-off claims joined it in 0835. A claim filed before then
 * has no run and is still decided by HR directly.
 */
/** The engine table behind each kind of Time Off item. */
function subjectTableOf(kind: "request" | "encashment" | "claim"): string {
  return kind === "request"
    ? WORKFLOWS.timeoff_request.subjectTable
    : kind === "encashment"
      ? WORKFLOWS.timeoff_encashment.subjectTable
      : WORKFLOWS.timeoff_comp_off.subjectTable;
}

export async function decideTimeoff(
  items: { kind: "request" | "encashment" | "claim"; id: string }[],
  decision: "approve" | "reject",
  comment: string,
): Promise<R> {
  if (decision === "reject" && !comment.trim()) return bad("Say why — a reason is required to reject");
  let done = 0;
  const failures: string[] = [];
  // Claims without a run (filed before 0835) — the old one-step decision.
  const claims: string[] = [];
  for (const it of items.filter((i) => i.kind === "claim")) {
    const run = await getRunForSubject(subjectTableOf("claim"), it.id).catch(() => null);
    if (!run) claims.push(it.id);
  }

  if (claims.length) {
    const s = await createClient();
    const { data, error } = await s.rpc("timeoff_decide_comp_off", {
      p_ids: claims,
      p_decision: decision === "approve" ? "approved" : "rejected",
      p_remark: comment,
    });
    if (error) failures.push(dbMessage(error, "Could not decide the claims"));
    else done += Number(data ?? 0);
  }
  for (const it of items.filter((i) => !claims.includes(i.id))) {
    const r = await actOnSubject({
      subjectTable: subjectTableOf(it.kind),
      subjectId: it.id,
      action: decision,
      comment: comment.trim() || undefined,
      subjectPath: "/hr/time-off/approvals",
    });
    if (r.ok) done += 1;
    else failures.push(r.error);
  }
  revalidateTimeoff();
  if (failures.length) {
    return bad(done ? `${done} done; ${failures.length} refused — ${failures[0]}` : failures[0]);
  }
  return { ok: true, count: done };
}

/**
 * "This needs the next person" — the HOD sends a request to the HR Manager,
 * the HR Manager to the ED (0820). Not an approval: whoever approves closes
 * the request, so sending it on is the only way it climbs a stage.
 */
export async function forwardTimeoff(kind: "request" | "encashment" | "claim", id: string, comment: string): Promise<R> {
  const run = await getRunForSubject(subjectTableOf(kind), id).catch(() => null);
  if (!run || run.status !== "in_progress") return bad("This request is no longer waiting for a decision — reload");
  const s = await createClient();
  const { error } = await s.rpc("hr_approval_forward", { p_run_id: run.id, p_comment: comment.trim() || null });
  if (error) return bad(dbMessage(error, "Could not send it on"));
  after(() => notifyCurrentApprovers(run.id, { reason: "advanced" }));
  revalidateTimeoff();
  return { ok: true, count: 1 };
}

// ─── Comp-off ──────────────────────────────────────────────────────────────

export async function claimCompOff(person: string, dates: string[], credit: number, reason: string): Promise<R> {
  if (!person) return bad("Pick the person");
  if (dates.length === 0) return bad("Pick at least one worked date");
  if (!reason.trim()) return bad("Say what the work was");
  const who = splitPersonKey(person);
  const s = await createClient();
  const { data, error } = await s.rpc("timeoff_claim_comp_off", {
    p_staff_id: who.staff_id,
    p_worker_id: who.worker_id,
    p_dates: dates,
    p_credit: credit,
    p_reason: reason,
  });
  if (error) return bad(dbMessage(error, "Could not claim"));
  // Each credit started its own run (0835): tell the HOD (or whoever has it).
  const { data: made } = await s
    .from("timeoff_comp_off_credits")
    .select("id")
    .eq(who.staff_id ? "staff_id" : "worker_id", (who.staff_id ?? who.worker_id) as string)
    .in("worked_date", dates)
    .eq("status", "pending");
  for (const c of (made ?? []) as { id: string }[]) notifyStarted(subjectTableOf("claim"), c.id);
  revalidateTimeoff();
  return { ok: true, count: Number(data ?? 0) };
}

export async function withdrawCompOff(id: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("timeoff_decide_comp_off", { p_ids: [id], p_decision: "withdrawn", p_remark: null });
  if (error) return bad(dbMessage(error, "Could not withdraw"));
  revalidateTimeoff();
  return { ok: true };
}

// ─── Encashment ────────────────────────────────────────────────────────────

export async function requestEncashment(person: string, leaveTypeId: string, days: number, reason: string): Promise<R> {
  if (!person) return bad("Pick the person");
  if (!leaveTypeId) return bad("Pick the leave type");
  if (!(days > 0)) return bad("Enter the days to encash");
  if (!reason.trim()) return bad("The reason is mandatory");
  const who = splitPersonKey(person);
  const s = await createClient();
  const { data, error } = await s.rpc("timeoff_request_encashment", {
    p_staff_id: who.staff_id,
    p_worker_id: who.worker_id,
    p_leave_type_id: leaveTypeId,
    p_days: days,
    p_reason: reason,
  });
  if (error) return bad(dbMessage(error, "Could not request the encashment"));
  const id = data as string;
  notifyStarted(WORKFLOWS.timeoff_encashment.subjectTable, id);
  revalidateTimeoff();
  return { ok: true, id };
}

export async function markEncashmentPaid(id: string, ref: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.rpc("timeoff_mark_encashment_paid", { p_id: id, p_ref: ref });
  if (error) return bad(dbMessage(error, "Could not mark it paid"));
  revalidateTimeoff();
  return { ok: true };
}

// ─── Setup: types, years, blackouts ────────────────────────────────────────

export async function saveLeaveType(id: string | null, payload: LeaveTypeInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = leaveTypeInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const q = id
    ? s.from("timeoff_leave_types").update(p.data).eq("id", id).select("id").single()
    : s.from("timeoff_leave_types").insert(p.data).select("id").single();
  const { data, error } = await q;
  if (error || !data) {
    if (error?.code === "23505") return bad("A leave type with this code already exists");
    return bad(dbMessage(error, "Could not save the leave type"));
  }
  revalidateTimeoff();
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteLeaveType(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("timeoff_leave_types").delete().eq("id", id);
  if (error) {
    // 23503: requests or balances point at it — switch it off instead.
    if (error.code === "23503") return bad("This type has been used — switch it to Inactive instead of deleting it");
    return bad(dbMessage(error, "Could not delete"));
  }
  revalidateTimeoff();
  return { ok: true };
}

export async function saveYear(id: string | null, payload: YearInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = yearInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const q = id
    ? s.from("timeoff_years").update(p.data).eq("id", id).select("id").single()
    : s.from("timeoff_years").insert(p.data).select("id").single();
  const { data, error } = await q;
  if (error || !data) return bad(dbMessage(error, "Could not save the year"));
  revalidateTimeoff();
  return { ok: true, id: (data as { id: string }).id };
}

export async function saveBlackout(id: string | null, payload: BlackoutInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = blackoutInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const q = id
    ? s.from("timeoff_blackouts").update(p.data).eq("id", id).select("id").single()
    : s.from("timeoff_blackouts").insert(p.data).select("id").single();
  const { data, error } = await q;
  if (error || !data) return bad(dbMessage(error, "Could not save the blackout"));
  revalidateTimeoff();
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteBlackout(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("timeoff_blackouts").delete().eq("id", id);
  if (error) return bad(dbMessage(error, "Could not delete"));
  revalidateTimeoff();
  return { ok: true };
}

// ─── Approval flow: department heads (0817) ────────────────────────────────

/** Name (or clear) the HOD of a department — step 1 of every HR request. */
export async function saveDepartmentHead(departmentId: string, staffId: string | null): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = staffId
    ? await s.from("hr_department_heads").upsert({ department_id: departmentId, staff_id: staffId }, { onConflict: "department_id" })
    : await s.from("hr_department_heads").delete().eq("department_id", departmentId);
  if (error) return bad(dbMessage(error, "Could not save the HOD"));
  revalidateTimeoff();
  return { ok: true };
}

/** Which role answers the HR Manager stage or the ED stage (0842); null = not set. */
export async function saveStageRole(stage: "hr" | "ed", roleId: string | null): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { data, error } = await s
    .from("hr_approval_settings")
    .update(stage === "hr" ? { hr_role_id: roleId } : { ed_role_id: roleId })
    .eq("id", true)
    .select("id");
  if (error) return bad(dbMessage(error, "Could not save the stage"));
  // RLS turns a refused UPDATE into 0 rows, not an error.
  if (!data?.length) return bad("Could not save the stage — run migration 0842 first.");
  revalidateTimeoff();
  return { ok: true };
}

// ─── Balances: overrides and opening figures ───────────────────────────────

export async function saveEntitlement(payload: EntitlementInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = entitlementInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const v = p.data;
  const who = splitPersonKey(v.person);
  const s = await createClient();
  let q = s
    .from("timeoff_entitlements")
    .select("id")
    .eq("year_id", v.year_id)
    .eq("leave_type_id", v.leave_type_id);
  q = who.staff_id ? q.eq("staff_id", who.staff_id) : q.eq("worker_id", who.worker_id as string);
  const { data: existing, error: readErr } = await q.maybeSingle();
  if (readErr) return bad(readErr.message);
  const row = {
    entitled_days: v.entitled_days,
    carried_forward: v.carried_forward,
    opening_used: v.opening_used,
    reason: v.reason,
  };
  const { error } = existing
    ? await s.from("timeoff_entitlements").update(row).eq("id", (existing as { id: string }).id)
    : await s.from("timeoff_entitlements").insert({
        ...row,
        year_id: v.year_id,
        leave_type_id: v.leave_type_id,
        staff_id: who.staff_id,
        worker_id: who.worker_id,
      });
  if (error) return bad(dbMessage(error, "Could not save the balance"));
  revalidateTimeoff();
  return { ok: true };
}

export async function clearEntitlement(id: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("timeoff_entitlements").delete().eq("id", id);
  if (error) return bad(dbMessage(error, "Could not clear the override"));
  revalidateTimeoff();
  return { ok: true };
}
