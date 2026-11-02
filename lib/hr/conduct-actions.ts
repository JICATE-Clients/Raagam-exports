"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getRunForSubject } from "@/lib/approvals/service";
import { notifyCurrentApprovers } from "@/lib/approvals/notify";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getCaseDetail, listMemoEvents, listPolicyAcks } from "./conduct-service";
import { splitPersonKey } from "./timeoff-types";
import { POLICY_BUCKET, decisionProblem, type AppliesTo, type CaseDraft, type DecisionDraft, type MemoDraft, type PolicyDraft } from "./conduct-types";

/**
 * HR ▸ Conduct & Policies (0791) — the write half.
 *
 * Memos, cases and acknowledgements are written ONLY by the SECURITY DEFINER
 * functions in 0791, which hold every rule (who may answer a memo, one open
 * case per person, the stage order, publishing). Policies and their draft
 * versions are plain table writes under RLS, with their rules in triggers.
 */

type R = { ok: true; id?: string; count?: number } | { ok: false; error: string };
const bad = (error: string): R => ({ ok: false, error });
const msg = (e: { message?: string } | null, fallback: string) => e?.message || fallback;

function revalidateConduct(): void {
  revalidatePath("/hr/conduct", "layout");
  revalidatePath("/approvals");
}

// ─── Memos ─────────────────────────────────────────────────────────────────

export async function issueMemo(d: MemoDraft): Promise<R> {
  if (!d.person) return bad("Pick the person");
  if (!d.memo_type) return bad("Pick what the memo is about");
  if (!d.subject.trim()) return bad("Enter the subject");
  if (!d.body.trim()) return bad("Write the memo");
  const p = splitPersonKey(d.person);
  const s = await createClient();
  const { data, error } = await s.rpc("cd_issue_memo", {
    p: {
      staff_id: p.staff_id,
      worker_id: p.worker_id,
      memo_type: d.memo_type,
      subject: d.subject,
      body: d.body,
      incident_date: d.incident_date || null,
      issued_on: d.issued_on || null,
      reply_by: d.reply_by || null,
    },
  });
  if (error) return bad(msg(error, "Could not issue the memo"));
  revalidateConduct();
  return { ok: true, id: data as string };
}

export async function acknowledgeMemo(id: string, note: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("cd_acknowledge_memo", { p_id: id, p_note: note });
  if (error) return bad(msg(error, "Could not record it"));
  revalidateConduct();
  return { ok: true };
}

export async function disputeMemo(id: string, reason: string): Promise<R> {
  if (reason.trim().length < 10) return bad("Give the reason in at least 10 characters");
  const s = await createClient();
  const { error } = await s.rpc("cd_dispute_memo", { p_id: id, p_reason: reason });
  if (error) return bad(msg(error, "Could not record it"));
  revalidateConduct();
  return { ok: true };
}

export async function resolveMemo(id: string, note: string, counts: boolean): Promise<R> {
  if (note.trim().length < 5) return bad("Write how it was resolved (at least 5 characters)");
  const s = await createClient();
  const { error } = await s.rpc("cd_resolve_memo", { p_id: id, p_note: note, p_counts: counts });
  if (error) return bad(msg(error, "Could not resolve it"));
  revalidateConduct();
  return { ok: true };
}

export async function withdrawMemo(id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("cd_withdraw_memo", { p_id: id, p_reason: reason });
  if (error) return bad(msg(error, "Could not withdraw it"));
  revalidateConduct();
  return { ok: true };
}

export async function loadMemoEvents(id: string) {
  return listMemoEvents(id);
}

// ─── Cases ─────────────────────────────────────────────────────────────────

function caseBody(d: CaseDraft) {
  return {
    category: d.category,
    allegation: d.allegation,
    incident_date: d.incident_date || null,
    enquiry_officer: d.enquiry_officer || null,
    hearing_date: d.hearing_date || null,
  };
}

export async function openCase(d: CaseDraft): Promise<R> {
  if (!d.person) return bad("Pick the person");
  if (!d.category) return bad("Pick the kind of case");
  if (d.allegation.trim().length < 20) return bad("Describe what happened in at least 20 characters");
  const p = splitPersonKey(d.person);
  const s = await createClient();
  const { data, error } = await s.rpc("cd_open_case", {
    p: { ...caseBody(d), staff_id: p.staff_id, worker_id: p.worker_id, memo_ids: d.memo_ids },
  });
  if (error) return bad(msg(error, "Could not open the case"));
  revalidateConduct();
  return { ok: true, id: data as string };
}

export async function updateCase(id: string, d: CaseDraft): Promise<R> {
  if (d.allegation.trim().length < 20) return bad("Describe what happened in at least 20 characters");
  const s = await createClient();
  const { error } = await s.rpc("cd_update_case", { p_id: id, p: caseBody(d) });
  if (error) return bad(msg(error, "Could not save the case"));
  revalidateConduct();
  return { ok: true };
}

export async function advanceCase(id: string, note: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("cd_advance_case", { p_id: id, p_note: note });
  if (error) return bad(msg(error, "Could not move the case"));
  revalidateConduct();
  return { ok: true };
}

export async function addCaseNote(id: string, note: string): Promise<R> {
  if (!note.trim()) return bad("Write the note");
  const s = await createClient();
  const { error } = await s.rpc("cd_add_case_note", { p_id: id, p_note: note });
  if (error) return bad(msg(error, "Could not add the note"));
  revalidateConduct();
  return { ok: true };
}

export async function addWitness(
  id: string,
  w: { person: string; outside_name: string; statement: string; given_on: string },
): Promise<R> {
  if (!w.person && !w.outside_name.trim()) return bad("Pick the witness or type their name");
  if (!w.statement.trim()) return bad("Write the statement");
  const p = w.person ? splitPersonKey(w.person) : { staff_id: null, worker_id: null };
  const s = await createClient();
  const { error } = await s.rpc("cd_add_witness", {
    p_id: id,
    p: {
      staff_id: p.staff_id,
      worker_id: p.worker_id,
      outside_name: w.person ? null : w.outside_name,
      statement: w.statement,
      given_on: w.given_on || null,
    },
  });
  if (error) return bad(msg(error, "Could not record the statement"));
  revalidateConduct();
  return { ok: true };
}

export async function proposeDecision(id: string, d: DecisionDraft): Promise<R> {
  const problem = decisionProblem(d);
  if (problem) return bad(problem);
  const s = await createClient();
  const { error } = await s.rpc("cd_propose_decision", {
    p_id: id,
    p: {
      outcome: d.outcome,
      decision_note: d.decision_note,
      suspension_from: d.suspension_from || null,
      suspension_to: d.suspension_to || null,
      last_working_day: d.last_working_day || null,
    },
  });
  if (error) return bad(msg(error, "Could not send the decision"));
  after(async () => {
    const run = await getRunForSubject(WORKFLOWS.cd_case_decision.subjectTable, id).catch(() => null);
    if (run) await notifyCurrentApprovers(run.id, { reason: "started" });
  });
  revalidateConduct();
  return { ok: true };
}

export async function recallDecision(id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("cd_recall_decision", { p_id: id, p_reason: reason });
  if (error) return bad(msg(error, "Could not recall it"));
  revalidateConduct();
  return { ok: true };
}

export async function withdrawCase(id: string, reason: string): Promise<R> {
  if (reason.trim().length < 5) return bad("Say why (at least 5 characters)");
  const s = await createClient();
  const { error } = await s.rpc("cd_withdraw_case", { p_id: id, p_reason: reason });
  if (error) return bad(msg(error, "Could not withdraw the case"));
  revalidateConduct();
  return { ok: true };
}

export async function loadCaseDetail(id: string) {
  const [detail, panel] = await Promise.all([getCaseDetail(id), getApprovalPanel(WORKFLOWS.cd_case_decision.subjectTable, id)]);
  return { ...detail, panel };
}

// ─── Policies ──────────────────────────────────────────────────────────────

/**
 * Create a policy with its first draft, or save an existing policy's header
 * and its draft (starting a new draft when only a published version exists).
 * Publishing is separate — `publishPolicy`.
 */
export async function savePolicy(id: string | null, d: PolicyDraft, locationId: string | null): Promise<R> {
  if (!(await can("hr_payroll", id ? "edit" : "create"))) return bad("Forbidden");
  if (!d.title.trim()) return bad("Enter the policy's name");
  // A unit policy needs the unit; without one it would quietly become company-wide.
  if (!id && !d.company_wide && !locationId) return bad("Pick the unit you are working in first (top bar), or tick “For every unit”");
  const s = await createClient();
  const header = { title: d.title, category: d.category, applies_to: d.applies_to, requires_ack: d.requires_ack };
  let policyId = id;
  if (!policyId) {
    const { data, error } = await s
      .from("cd_policies")
      .insert({ ...header, location_id: d.company_wide ? null : locationId })
      .select("id")
      .single();
    if (error || !data) return bad(msg(error, "Could not save the policy"));
    policyId = (data as { id: string }).id;
  } else {
    const { error } = await s.from("cd_policies").update(header).eq("id", policyId);
    if (error) return bad(msg(error, "Could not save the policy"));
  }
  const version = { body: d.body.trim() || null, effective_from: d.effective_from || undefined, change_note: d.change_note || null };
  const { data: draft, error: de } = await s.from("cd_policy_versions").select("id").eq("policy_id", policyId).eq("status", "draft").maybeSingle();
  if (de) return bad(de.message);
  const vq = draft
    ? s.from("cd_policy_versions").update(version).eq("id", (draft as { id: string }).id)
    : s.from("cd_policy_versions").insert({ ...version, policy_id: policyId });
  const { error: ve } = await vq;
  if (ve) return bad(msg(ve, "Could not save the draft"));
  revalidateConduct();
  return { ok: true, id: policyId };
}

/** Start a new draft from the live version, so the change can be written. */
export async function startRevision(policyId: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { data: live, error } = await s
    .from("cd_policy_versions")
    .select("body, file_path, file_name")
    .eq("policy_id", policyId)
    .eq("status", "published")
    .maybeSingle();
  if (error) return bad(error.message);
  const l = (live ?? {}) as { body?: string | null; file_path?: string | null; file_name?: string | null };
  const { error: ie } = await s
    .from("cd_policy_versions")
    .insert({ policy_id: policyId, body: l.body ?? null, file_path: l.file_path ?? null, file_name: l.file_name ?? null });
  if (ie) return bad(msg(ie, "Could not start a new version"));
  revalidateConduct();
  return { ok: true };
}

export async function discardDraft(versionId: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error, count } = await s.from("cd_policy_versions").delete({ count: "exact" }).eq("id", versionId).eq("status", "draft");
  if (error) return bad(msg(error, "Could not discard the draft"));
  if (!count) return bad("That draft is already gone — reload");
  revalidateConduct();
  return { ok: true };
}

export async function deletePolicy(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error, count } = await s.from("cd_policies").delete({ count: "exact" }).eq("id", id);
  if (error) return bad(msg(error, "Could not delete the policy"));
  if (!count) return bad("Only a policy never published can be deleted — retire it instead");
  revalidateConduct();
  return { ok: true };
}

export async function setPolicyRetired(id: string, retired: boolean): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("cd_policies").update({ retired }).eq("id", id);
  if (error) return bad(msg(error, "Could not change the policy"));
  revalidateConduct();
  return { ok: true };
}

export async function publishPolicy(versionId: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("cd_publish_version", { p_version: versionId });
  if (error) return bad(msg(error, "Could not publish"));
  revalidateConduct();
  return { ok: true };
}

/**
 * The browser uploads the PDF straight to the private bucket under
 * <policy>/; this links it to the draft. The file it replaces is removed
 * (the delete policy allows it while no published version points at it).
 */
export async function attachPolicyDoc(versionId: string, path: string, name: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { data: prev } = await s.from("cd_policy_versions").select("file_path").eq("id", versionId).maybeSingle();
  const { error } = await s.from("cd_policy_versions").update({ file_path: path, file_name: name }).eq("id", versionId);
  if (error) {
    await s.storage.from(POLICY_BUCKET).remove([path]);
    return bad(msg(error, "Could not attach the document"));
  }
  const old = (prev as { file_path: string | null } | null)?.file_path;
  if (old && old !== path) await s.storage.from(POLICY_BUCKET).remove([old]);
  revalidateConduct();
  return { ok: true };
}

export async function removePolicyDoc(versionId: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { data: prev } = await s.from("cd_policy_versions").select("file_path").eq("id", versionId).maybeSingle();
  const { error } = await s.from("cd_policy_versions").update({ file_path: null, file_name: null }).eq("id", versionId);
  if (error) return bad(msg(error, "Could not remove the document"));
  const old = (prev as { file_path: string | null } | null)?.file_path;
  if (old) await s.storage.from(POLICY_BUCKET).remove([old]);
  revalidateConduct();
  return { ok: true };
}

export async function policyDocLink(path: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const s = await createClient();
  const { data, error } = await s.storage.from(POLICY_BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return { ok: false, error: "The document could not be opened" };
  return { ok: true, url: data.signedUrl };
}

export async function acknowledgePolicy(versionId: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("cd_acknowledge_policy", { p_version: versionId });
  if (error) return bad(msg(error, "Could not record it"));
  revalidateConduct();
  return { ok: true };
}

export async function recordAcks(versionId: string, keys: string[]): Promise<R> {
  if (!keys.length) return bad("Tick the people who signed");
  const staff = keys.flatMap((k) => (k.startsWith("staff:") ? [k.slice(6)] : []));
  const workers = keys.flatMap((k) => (k.startsWith("worker:") ? [k.slice(7)] : []));
  const s = await createClient();
  const { data, error } = await s.rpc("cd_record_acks", { p_version: versionId, p_staff: staff, p_workers: workers });
  if (error) return bad(msg(error, "Could not record them"));
  revalidateConduct();
  return { ok: true, count: data as number };
}

export async function removeAck(id: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("cd_remove_ack", { p_id: id });
  if (error) return bad(msg(error, "Could not remove it"));
  revalidateConduct();
  return { ok: true };
}

export async function loadPolicyAcks(appliesTo: AppliesTo, versionId: string) {
  return listPolicyAcks({ applies_to: appliesTo }, versionId);
}
