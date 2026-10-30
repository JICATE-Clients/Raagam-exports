"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getRunForSubject } from "@/lib/approvals/service";
import { notifyCurrentApprovers } from "@/lib/approvals/notify";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { listEnrolments } from "./performance-service";
import { splitPersonKey } from "./timeoff-types";
import {
  CERT_BUCKET,
  roundInput,
  trainingInput,
  type Enrolment,
  type EnrolmentStatus,
  type PromotionDraft,
  type ReviewDraft,
  type RoundInput,
  type RoundStatus,
  type TrainingInput,
  type TrainingStatus,
} from "./performance-types";

/**
 * HR ▸ Performance & Growth (0773) — the write half.
 *
 * Appraisals and promotions are written ONLY by the SECURITY DEFINER
 * functions in 0773, which hold every rule (who rates which step, the round's
 * state, one promotion waiting per person). Rounds, trainings and enrolments
 * are plain table writes under RLS, with their rules in triggers.
 */

type R = { ok: true; id?: string; count?: number } | { ok: false; error: string };
const bad = (error: string): R => ({ ok: false, error });
const msg = (e: { message?: string } | null, fallback: string) => e?.message || fallback;

function revalidatePerformance(): void {
  revalidatePath("/hr/performance", "layout");
  revalidatePath("/approvals");
}

function notifyStarted(subjectTable: string, id: string): void {
  after(async () => {
    const run = await getRunForSubject(subjectTable, id).catch(() => null);
    if (run) await notifyCurrentApprovers(run.id, { reason: "started" });
  });
}

// ─── Rounds ────────────────────────────────────────────────────────────────

export async function saveRound(id: string | null, payload: RoundInput): Promise<R> {
  if (!(await can("hr_payroll", id ? "edit" : "create"))) return bad("Forbidden");
  const p = roundInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const q = id
    ? s.from("pf_rounds").update(p.data).eq("id", id).select("id").single()
    : s.from("pf_rounds").insert(p.data).select("id").single();
  const { data, error } = await q;
  if (error || !data) return bad(msg(error, "Could not save the round"));
  revalidatePerformance();
  return { ok: true, id: (data as { id: string }).id };
}

export async function setRoundStatus(id: string, status: RoundStatus): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("pf_rounds").update({ status }).eq("id", id);
  if (error) return bad(msg(error, "Could not change the round"));
  revalidatePerformance();
  return { ok: true };
}

export async function deleteRound(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error, count } = await s.from("pf_rounds").delete({ count: "exact" }).eq("id", id);
  if (error) {
    if (error.code === "23503") return bad("People are in this round — remove them first");
    return bad(msg(error, "Could not delete"));
  }
  if (!count) return bad("Only a draft round can be deleted");
  revalidatePerformance();
  return { ok: true };
}

// ─── Appraisals ────────────────────────────────────────────────────────────

export async function addPeopleToRound(roundId: string, keys: string[], selfRating: boolean): Promise<R> {
  if (keys.length === 0) return bad("Pick at least one person");
  const staff: string[] = [];
  const workers: string[] = [];
  for (const k of keys) {
    const p = splitPersonKey(k);
    if (p.staff_id) staff.push(p.staff_id);
    else if (p.worker_id) workers.push(p.worker_id);
  }
  const s = await createClient();
  const { data, error } = await s.rpc("pf_add_people", {
    p_round: roundId,
    p_staff: staff,
    p_workers: workers,
    p_self: selfRating,
  });
  if (error) return bad(msg(error, "Could not add people"));
  revalidatePerformance();
  return { ok: true, count: data as number };
}

export async function removeReviews(ids: string[]): Promise<R> {
  const s = await createClient();
  const { data, error } = await s.rpc("pf_remove_reviews", { p_ids: ids });
  if (error) return bad(msg(error, "Could not remove"));
  revalidatePerformance();
  return { ok: true, count: data as number };
}

export async function setReviewer(ids: string[], reviewerId: string | null): Promise<R> {
  const s = await createClient();
  const { data, error } = await s.rpc("pf_set_reviewer", { p_ids: ids, p_reviewer: reviewerId });
  if (error) return bad(msg(error, "Could not change the supervisor"));
  revalidatePerformance();
  return { ok: true, count: data as number };
}

export async function saveSelfRating(id: string, draft: ReviewDraft, submit: boolean): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("pf_save_self", { p_id: id, p: draft, p_submit: submit });
  if (error) return bad(msg(error, "Could not save the rating"));
  revalidatePerformance();
  return { ok: true };
}

export async function saveSupervisorRating(id: string, draft: ReviewDraft, submit: boolean): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("pf_save_supervisor", { p_id: id, p: draft, p_submit: submit });
  if (error) return bad(msg(error, "Could not save the rating"));
  if (submit) notifyStarted(WORKFLOWS.pf_review.subjectTable, id);
  revalidatePerformance();
  return { ok: true };
}

export async function sendBackReview(id: string, note: string): Promise<R> {
  if (!note.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("pf_send_back", { p_id: id, p_note: note });
  if (error) return bad(msg(error, "Could not send it back"));
  revalidatePerformance();
  return { ok: true };
}

export async function recallReview(id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("pf_recall_review", { p_id: id, p_reason: reason });
  if (error) return bad(msg(error, "Could not recall"));
  revalidatePerformance();
  return { ok: true };
}

export async function loadReviewPanel(id: string) {
  return getApprovalPanel(WORKFLOWS.pf_review.subjectTable, id);
}

// ─── Promotions ────────────────────────────────────────────────────────────

export async function raisePromotion(draft: PromotionDraft): Promise<R> {
  if (!draft.person) return bad("Pick the person");
  if (!draft.to_designation_id) return bad("Pick the new designation");
  if (!draft.effective_date) return bad("Enter the date it takes effect");
  if (!draft.reason.trim()) return bad("Say why they are being promoted");
  const who = splitPersonKey(draft.person);
  const s = await createClient();
  const { data, error } = await s.rpc("pf_raise_promotion", {
    p: {
      staff_id: who.staff_id,
      worker_id: who.worker_id,
      to_designation_id: draft.to_designation_id,
      proposed_salary: draft.proposed_salary || null,
      effective_date: draft.effective_date,
      reason: draft.reason,
      review_id: draft.review_id || null,
    },
  });
  if (error) return bad(msg(error, "Could not raise the promotion"));
  const id = data as string;
  notifyStarted(WORKFLOWS.pf_promotion.subjectTable, id);
  revalidatePerformance();
  return { ok: true, id };
}

export async function withdrawPromotion(id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("pf_withdraw_promotion", { p_id: id, p_reason: reason });
  if (error) return bad(msg(error, "Could not withdraw"));
  revalidatePerformance();
  return { ok: true };
}

export async function loadPromotionPanel(id: string) {
  return getApprovalPanel(WORKFLOWS.pf_promotion.subjectTable, id);
}

// ─── Training ──────────────────────────────────────────────────────────────

export async function saveTraining(id: string | null, payload: TrainingInput): Promise<R> {
  if (!(await can("hr_payroll", id ? "edit" : "create"))) return bad("Forbidden");
  const p = trainingInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const { status, ...rest } = p.data;
  const s = await createClient();
  const q = id
    ? s.from("pf_trainings").update(rest).eq("id", id).select("id").single()
    : s.from("pf_trainings").insert({ ...rest, status: status ?? "open" }).select("id").single();
  const { data, error } = await q;
  if (error || !data) return bad(msg(error, "Could not save the training"));
  revalidatePerformance();
  return { ok: true, id: (data as { id: string }).id };
}

export async function setTrainingStatus(id: string, status: TrainingStatus, reason: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  if (status === "cancelled" && !reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s
    .from("pf_trainings")
    .update({ status, cancel_reason: status === "cancelled" ? reason : null })
    .eq("id", id);
  if (error) return bad(msg(error, "Could not change the training"));
  revalidatePerformance();
  return { ok: true };
}

export async function deleteTraining(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error, count } = await s.from("pf_trainings").delete({ count: "exact" }).eq("id", id);
  if (error) return bad(msg(error, "Could not delete"));
  if (!count) return bad("Only a draft training can be deleted — cancel it instead");
  revalidatePerformance();
  return { ok: true };
}

export async function loadEnrolments(trainingId: string): Promise<Enrolment[]> {
  return listEnrolments({ trainingId });
}

export async function enrolPeople(trainingId: string, keys: string[]): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  if (keys.length === 0) return bad("Pick at least one person");
  const rows = keys.map((k) => ({ training_id: trainingId, ...splitPersonKey(k) }));
  const s = await createClient();
  // One row at a time, so a full training says so after the seats it had.
  let n = 0;
  for (const row of rows) {
    const { error } = await s.from("pf_enrolments").insert(row);
    if (error) {
      if (error.code === "23505" && !error.message.includes("full")) continue; // already on it
      revalidatePerformance();
      return bad(n ? `${n} added, then: ${msg(error, "could not add")}` : msg(error, "Could not add"));
    }
    n++;
  }
  revalidatePerformance();
  return { ok: true, count: n };
}

export async function setEnrolmentStatus(ids: string[], status: EnrolmentStatus, remark: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  if (ids.length === 0) return bad("Pick at least one person");
  if (status === "dropped" && !remark.trim()) return bad("Say why");
  const s = await createClient();
  const patch: Record<string, unknown> = { status };
  if (remark.trim()) patch.remark = remark;
  const { error, count } = await s.from("pf_enrolments").update(patch, { count: "exact" }).in("id", ids);
  if (error) return bad(msg(error, "Could not update"));
  revalidatePerformance();
  return { ok: true, count: count ?? ids.length };
}

export async function removeEnrolment(id: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error, count } = await s.from("pf_enrolments").delete({ count: "exact" }).eq("id", id);
  if (error) return bad(msg(error, "Could not remove"));
  if (!count) return bad("Once the training has started, mark them dropped instead");
  revalidatePerformance();
  return { ok: true };
}

/**
 * The browser uploads the certificate straight to the private bucket under
 * <unit>/<training>/; this links it to the enrolment, and the trigger checks
 * the file is there and was uploaded by the caller. The file it replaces is
 * removed (the delete policy allows it once nothing points at it).
 */
export async function attachCertificate(id: string, path: string, name: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { data: prev } = await s.from("pf_enrolments").select("certificate_path").eq("id", id).maybeSingle();
  const { error } = await s.from("pf_enrolments").update({ certificate_path: path, certificate_name: name }).eq("id", id);
  if (error) {
    await s.storage.from(CERT_BUCKET).remove([path]);
    return bad(msg(error, "Could not attach the certificate"));
  }
  const old = (prev as { certificate_path: string | null } | null)?.certificate_path;
  if (old && old !== path) await s.storage.from(CERT_BUCKET).remove([old]);
  revalidatePerformance();
  return { ok: true };
}

export async function certificateLink(path: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const s = await createClient();
  const { data, error } = await s.storage.from(CERT_BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return { ok: false, error: "The certificate could not be opened" };
  return { ok: true, url: data.signedUrl };
}
