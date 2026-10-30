"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getRunForSubject } from "@/lib/approvals/service";
import { notifyCurrentApprovers } from "@/lib/approvals/notify";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getCandidateEvents, listInterviews } from "./recruitment-service";
import { splitPersonKey } from "./timeoff-types";
import {
  RESUME_BUCKET,
  jobInput,
  type CandidateDraft,
  type CandidateEvent,
  type Interview,
  type JobInput,
  type MoveTo,
  type Recommendation,
  type SelectionDraft,
} from "./recruitment-types";

/**
 * HR ▸ Recruitment (0767) — the write half.
 *
 * Candidates, their timeline, interviews and scorecards are written ONLY by
 * the SECURITY DEFINER functions in 0767, which hold every rule (who may act
 * in which unit, the stage map, one live interview at a time, a panel
 * member's own marks). Job openings are a plain table write under RLS.
 */

type R = { ok: true; id?: string; count?: number } | { ok: false; error: string };
const bad = (error: string): R => ({ ok: false, error });

function dbMessage(e: { message?: string; code?: string } | null, fallback: string): string {
  if (!e) return fallback;
  return e.message || fallback;
}

function revalidateRecruitment(): void {
  revalidatePath("/hr/recruitment", "layout");
  revalidatePath("/approvals");
}

// ─── Jobs ──────────────────────────────────────────────────────────────────

export async function saveJob(id: string | null, payload: JobInput): Promise<R> {
  if (!(await can("hr_payroll", id ? "edit" : "create"))) return bad("Forbidden");
  const p = jobInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const q = id
    ? s.from("rc_jobs").update(p.data).eq("id", id).select("id").single()
    : s.from("rc_jobs").insert(p.data).select("id").single();
  const { data, error } = await q;
  if (error || !data) return bad(dbMessage(error, "Could not save the job"));
  revalidateRecruitment();
  return { ok: true, id: (data as { id: string }).id };
}

export async function setJobStatus(id: string, status: "open" | "on_hold" | "closed", reason: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  if (status === "closed" && !reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s
    .from("rc_jobs")
    .update({ status, close_reason: status === "closed" ? reason.trim().toUpperCase() : null })
    .eq("id", id);
  if (error) return bad(dbMessage(error, "Could not change the job"));
  revalidateRecruitment();
  return { ok: true };
}

export async function deleteJob(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("rc_jobs").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return bad("This job has candidates — close it instead");
    return bad(dbMessage(error, "Could not delete"));
  }
  revalidateRecruitment();
  return { ok: true };
}

// ─── Candidates ────────────────────────────────────────────────────────────

/**
 * The browser uploads the résumé straight to the private bucket under
 * <unit>/<job>/ (the insert policy lets only HR in the job's unit write
 * there), then saves the candidate with the path; the database checks the
 * file is there and was uploaded by the caller.
 */
export async function saveCandidate(id: string | null, draft: CandidateDraft): Promise<R> {
  const s = await createClient();
  const { data, error } = await s.rpc("rc_save_candidate", { p_id: id, p: draft });
  if (error) {
    // Leave nothing behind for a save that failed on a fresh upload.
    if (draft.resume_path && !id) await s.storage.from(RESUME_BUCKET).remove([draft.resume_path]);
    return bad(dbMessage(error, "Could not save the candidate"));
  }
  revalidateRecruitment();
  return { ok: true, id: data as string };
}

export async function discardResumeUpload(path: string): Promise<void> {
  const s = await createClient();
  await s.storage.from(RESUME_BUCKET).remove([path]);
}

export async function resumeLink(path: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const s = await createClient();
  const { data, error } = await s.storage.from(RESUME_BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return { ok: false, error: "The résumé could not be opened" };
  return { ok: true, url: data.signedUrl };
}

export async function deleteCandidate(id: string): Promise<R> {
  const s = await createClient();
  const { data, error } = await s.rpc("rc_delete_candidate", { p_id: id });
  if (error) return bad(dbMessage(error, "Could not delete"));
  if (data) await s.storage.from(RESUME_BUCKET).remove([data as string]);
  revalidateRecruitment();
  return { ok: true };
}

export async function moveCandidates(ids: string[], to: MoveTo, note: string): Promise<R> {
  if (ids.length === 0) return bad("Pick at least one candidate");
  const s = await createClient();
  const { data, error } = await s.rpc("rc_move_candidates", { p_ids: ids, p_to: to, p_note: note || null });
  if (error) return bad(dbMessage(error, "Could not move"));
  revalidateRecruitment();
  return { ok: true, count: data as number };
}

export async function addCandidateNote(id: string, note: string): Promise<R> {
  if (!note.trim()) return bad("Write the note");
  const s = await createClient();
  const { error } = await s.rpc("rc_add_note", { p_id: id, p_note: note });
  if (error) return bad(dbMessage(error, "Could not add the note"));
  revalidateRecruitment();
  return { ok: true };
}

export async function loadCandidateDetail(id: string): Promise<{ events: CandidateEvent[]; interviews: Interview[] }> {
  const [events, interviews] = await Promise.all([getCandidateEvents(id), listInterviews({ candidateId: id })]);
  return { events, interviews };
}

export async function loadHirePanel(id: string) {
  return getApprovalPanel(WORKFLOWS.rc_hire.subjectTable, id);
}

export async function submitSelection(id: string, draft: SelectionDraft): Promise<R> {
  if (!(Number(draft.salary) > 0)) return bad("Enter the salary offered");
  if (!draft.joining_date) return bad("Enter the joining date");
  const s = await createClient();
  const { error } = await s.rpc("rc_submit_selection", { p_id: id, p: draft });
  if (error) return bad(dbMessage(error, "Could not send for approval"));
  after(async () => {
    const run = await getRunForSubject(WORKFLOWS.rc_hire.subjectTable, id).catch(() => null);
    if (run) await notifyCurrentApprovers(run.id, { reason: "started" });
  });
  revalidateRecruitment();
  return { ok: true };
}

export async function recallSelection(id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("rc_recall_selection", { p_id: id, p_reason: reason });
  if (error) return bad(dbMessage(error, "Could not recall"));
  revalidateRecruitment();
  return { ok: true };
}

export async function markJoined(id: string, person: string, joinedOn: string, templateId: string): Promise<R> {
  if (!person) return bad("Pick the staff or worker record made for them");
  const who = splitPersonKey(person);
  const s = await createClient();
  const { error } = await s.rpc("rc_mark_joined", {
    p_id: id,
    p_staff: who.staff_id,
    p_worker: who.worker_id,
    p_joined: joinedOn || null,
    p_template: templateId || null,
  });
  if (error) return bad(dbMessage(error, "Could not mark joined"));
  revalidateRecruitment();
  revalidatePath("/hr/team", "layout");
  return { ok: true };
}

// ─── Interviews ────────────────────────────────────────────────────────────

export async function scheduleInterview(payload: {
  candidate_id: string;
  round_name: string;
  scheduled_at: string;
  duration_min: number;
  mode: string;
  venue: string;
  panel: string[];
}): Promise<R> {
  if (!payload.scheduled_at) return bad("Pick the date and time");
  if (payload.panel.length === 0) return bad("Pick at least one person for the panel");
  const s = await createClient();
  const { data, error } = await s.rpc("rc_schedule_interview", {
    p_candidate: payload.candidate_id,
    p_round_name: payload.round_name,
    p_at: new Date(payload.scheduled_at).toISOString(),
    p_duration: payload.duration_min,
    p_mode: payload.mode,
    p_venue: payload.venue || null,
    p_panel: payload.panel,
  });
  if (error) return bad(dbMessage(error, "Could not schedule"));
  revalidateRecruitment();
  return { ok: true, id: data as string };
}

export async function rescheduleInterview(
  id: string,
  payload: { scheduled_at: string; venue: string; panel: string[]; reason: string },
): Promise<R> {
  if (!payload.scheduled_at) return bad("Pick the new date and time");
  if (!payload.reason.trim()) return bad("Say why");
  const s = await createClient();
  const { data, error } = await s.rpc("rc_reschedule_interview", {
    p_id: id,
    p_at: new Date(payload.scheduled_at).toISOString(),
    p_venue: payload.venue || null,
    p_panel: payload.panel.length ? payload.panel : null,
    p_reason: payload.reason,
  });
  if (error) return bad(dbMessage(error, "Could not reschedule"));
  revalidateRecruitment();
  return { ok: true, id: data as string };
}

export async function closeInterview(id: string, status: "completed" | "cancelled" | "no_show", note: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("rc_close_interview", { p_id: id, p_status: status, p_note: note || null });
  if (error) return bad(dbMessage(error, "Could not close the interview"));
  revalidateRecruitment();
  return { ok: true };
}

export async function saveScorecard(payload: {
  interview_id: string;
  interviewer_id: string;
  skill: number;
  communication: number;
  attitude: number;
  experience: number;
  recommendation: Recommendation;
  comments: string;
}): Promise<R> {
  const marks = [payload.skill, payload.communication, payload.attitude, payload.experience];
  if (marks.some((m) => !(m >= 1 && m <= 5))) return bad("Give every mark from 1 to 5");
  const s = await createClient();
  const { error } = await s.rpc("rc_save_scorecard", {
    p_interview: payload.interview_id,
    p_interviewer: payload.interviewer_id,
    p_skill: payload.skill,
    p_communication: payload.communication,
    p_attitude: payload.attitude,
    p_experience: payload.experience,
    p_recommendation: payload.recommendation,
    p_comments: payload.comments || null,
  });
  if (error) return bad(dbMessage(error, "Could not save the marks"));
  revalidateRecruitment();
  return { ok: true };
}
