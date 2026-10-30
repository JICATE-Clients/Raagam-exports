"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getRunForSubject } from "@/lib/approvals/service";
import { notifyCurrentApprovers } from "@/lib/approvals/notify";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getExitSteps, getOnboardingSteps } from "./lifecycle-service";
import { splitPersonKey } from "./timeoff-types";
import {
  DOC_BUCKET,
  assetInput,
  assetReturnInput,
  exitInput,
  requiredDocInput,
  settingsInput,
  templateInput,
  type AssetInput,
  type AssetReturnInput,
  type ExitInput,
  type ExitStep,
  type OnboardingStep,
  type RequiredDocInput,
  type SettingsInput,
  type SettlementDraft,
  type SettlementPrefill,
  type TemplateInput,
} from "./lifecycle-types";

/**
 * HR ▸ Team Lifecycle (0771) — the write half.
 *
 * Joining progress, document registration and review, exits and settlements
 * are written ONLY by the SECURITY DEFINER functions in 0771, which hold every
 * rule (who may act for whom, one live exit per person, assets back before the
 * asset step, an approved settlement before the settled step). The catalogs,
 * settings and the asset register are plain table writes under RLS.
 */

type R = { ok: true; id?: string; count?: number } | { ok: false; error: string };
const bad = (error: string): R => ({ ok: false, error });

function dbMessage(e: { message?: string; code?: string } | null, fallback: string): string {
  if (!e) return fallback;
  if (e.code === "23505") return "That already exists";
  return e.message || fallback;
}

function revalidateLifecycle(): void {
  revalidatePath("/hr/team", "layout");
  revalidatePath("/approvals");
}

function notifyStarted(table: string, id: string): void {
  after(async () => {
    const run = await getRunForSubject(table, id).catch(() => null);
    if (run) await notifyCurrentApprovers(run.id, { reason: "started" });
  });
}

// ─── Joining ───────────────────────────────────────────────────────────────

export async function startOnboarding(person: string, templateId: string, startDate: string): Promise<R> {
  if (!person) return bad("Pick the person");
  if (!templateId) return bad("Pick the checklist");
  const who = splitPersonKey(person);
  const s = await createClient();
  const { data, error } = await s.rpc("lc_start_onboarding", {
    p_staff: who.staff_id,
    p_worker: who.worker_id,
    p_template: templateId,
    p_start: startDate || null,
  });
  if (error) return bad(dbMessage(error, "Could not start the checklist"));
  revalidateLifecycle();
  return { ok: true, id: data as string };
}

export async function loadOnboardingSteps(id: string): Promise<OnboardingStep[]> {
  return getOnboardingSteps(id).catch(() => []);
}

export async function tickOnboardingStep(stepId: string, done: boolean, note: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("lc_tick_onboarding_step", { p_step: stepId, p_done: done, p_note: note || null });
  if (error) return bad(dbMessage(error, "Could not update the step"));
  revalidateLifecycle();
  return { ok: true };
}

export async function cancelOnboarding(id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("lc_cancel_onboarding", { p_id: id, p_reason: reason });
  if (error) return bad(dbMessage(error, "Could not cancel"));
  revalidateLifecycle();
  return { ok: true };
}

// ─── Documents ─────────────────────────────────────────────────────────────

/** The person's folder in the bucket — refused if the caller may not upload for them. */
export async function documentFolder(person: string): Promise<{ ok: true; folder: string } | { ok: false; error: string }> {
  if (!person) return { ok: false, error: "Pick the person" };
  const who = splitPersonKey(person);
  const s = await createClient();
  const { data, error } = await s.rpc("lc_doc_folder", { p_staff: who.staff_id, p_worker: who.worker_id });
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not prepare the upload") };
  return { ok: true, folder: data as string };
}

/**
 * The browser uploads straight to the private bucket (the insert policy lets
 * only HR in the person's unit, or the person themself, write into that
 * person's folder, and the bucket itself refuses anything but PDF / JPEG /
 * PNG over 5 MB). This registers the upload as the person's document.
 */
export async function registerDocument(payload: {
  person: string;
  required_doc_id: string | null;
  doc_name: string;
  storage_path: string;
  file_name: string;
  document_no: string;
  issued_on: string;
  expires_on: string;
}): Promise<R> {
  if (!payload.person) return bad("Pick the person");
  if (!payload.storage_path) return bad("Choose the file");
  const who = splitPersonKey(payload.person);
  const s = await createClient();
  const { data, error } = await s.rpc("lc_register_document", {
    p_staff: who.staff_id,
    p_worker: who.worker_id,
    p_required: payload.required_doc_id || null,
    p_doc_name: payload.doc_name || null,
    p_path: payload.storage_path,
    p_file_name: payload.file_name,
    p_document_no: payload.document_no || null,
    p_issued: payload.issued_on || null,
    p_expires: payload.expires_on || null,
  });
  if (error) {
    // Leave nothing behind for a registration that failed.
    await s.storage.from(DOC_BUCKET).remove([payload.storage_path]);
    return bad(dbMessage(error, "Could not save the document"));
  }
  revalidateLifecycle();
  return { ok: true, id: data as string };
}

/** An upload abandoned before it was registered (the sheet was cancelled). */
export async function discardDocumentUpload(path: string): Promise<R> {
  if (!path) return { ok: true };
  const s = await createClient();
  // The delete policy refuses any object a document row points at.
  await s.storage.from(DOC_BUCKET).remove([path]);
  return { ok: true };
}

export async function reviewDocuments(ids: string[], decision: "verified" | "rejected", note: string): Promise<R> {
  if (ids.length === 0) return bad("Pick at least one document");
  if (decision === "rejected" && !note.trim()) return bad("Say why it is rejected");
  const s = await createClient();
  const { data, error } = await s.rpc("lc_review_document", { p_ids: ids, p_status: decision, p_note: note || null });
  if (error) return bad(dbMessage(error, "Could not save the review"));
  revalidateLifecycle();
  return { ok: true, count: Number(data ?? 0) };
}

/** A one-minute link to open the file — signed with the caller's own client,
 *  so the bucket's read policy decides. */
export async function documentLink(path: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const s = await createClient();
  const { data, error } = await s.storage.from(DOC_BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return { ok: false, error: "The file could not be opened" };
  return { ok: true, url: data.signedUrl };
}

export async function saveRequiredDoc(id: string | null, payload: RequiredDocInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = requiredDocInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const q = id
    ? s.from("lc_required_documents").update(p.data).eq("id", id).select("id").single()
    : s.from("lc_required_documents").insert(p.data).select("id").single();
  const { data, error } = await q;
  if (error || !data) {
    if (error?.code === "23505") return bad("A document with this code already exists");
    return bad(dbMessage(error, "Could not save"));
  }
  revalidateLifecycle();
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteRequiredDoc(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("lc_required_documents").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return bad("Documents have been uploaded against this — switch it to Inactive instead");
    return bad(dbMessage(error, "Could not delete"));
  }
  revalidateLifecycle();
  return { ok: true };
}

// ─── Joining checklist templates ───────────────────────────────────────────

export async function saveTemplate(id: string | null, payload: TemplateInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = templateInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const q = id
    ? s.from("lc_checklist_templates").update(p.data).eq("id", id).select("id").single()
    : s.from("lc_checklist_templates").insert(p.data).select("id").single();
  const { data, error } = await q;
  if (error || !data) {
    if (error?.code === "23505") return bad("A checklist with this name already exists");
    return bad(dbMessage(error, "Could not save"));
  }
  revalidateLifecycle();
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteTemplate(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  // Running checklists keep their copied steps (template_id → null).
  const { error } = await s.from("lc_checklist_templates").delete().eq("id", id);
  if (error) return bad(dbMessage(error, "Could not delete"));
  revalidateLifecycle();
  return { ok: true };
}

// ─── Assets ────────────────────────────────────────────────────────────────

export async function issueAsset(payload: AssetInput): Promise<R> {
  if (!(await can("hr_payroll", "create"))) return bad("Forbidden");
  const p = assetInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const { person, ...rest } = p.data;
  const who = splitPersonKey(person);
  const s = await createClient();
  const { data, error } = await s
    .from("lc_assets")
    .insert({ ...rest, staff_id: who.staff_id, worker_id: who.worker_id })
    .select("id")
    .single();
  if (error || !data) return bad(dbMessage(error, "Could not issue the asset"));
  revalidateLifecycle();
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateAsset(id: string, payload: AssetInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = assetInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  // The person an asset was issued to does not change; issue a new one instead.
  const { person: _person, ...rest } = p.data;
  const s = await createClient();
  const { error } = await s.from("lc_assets").update(rest).eq("id", id);
  if (error) return bad(dbMessage(error, "Could not save"));
  revalidateLifecycle();
  return { ok: true };
}

export async function returnAsset(id: string, payload: AssetReturnInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = assetReturnInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const v = p.data;
  const s = await createClient();
  const { error } = await s
    .from("lc_assets")
    .update({
      status: v.status,
      returned_on: v.returned_on,
      return_condition: v.return_condition,
      recovery_amount: v.status === "returned" ? null : v.recovery_amount,
    })
    .eq("id", id)
    .eq("status", "issued");
  if (error) return bad(dbMessage(error, "Could not save"));
  revalidateLifecycle();
  return { ok: true };
}

export async function deleteAsset(id: string): Promise<R> {
  if (!(await can("hr_payroll", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("lc_assets").delete().eq("id", id);
  if (error) return bad(dbMessage(error, "Could not delete"));
  revalidateLifecycle();
  return { ok: true };
}

// ─── Exits ─────────────────────────────────────────────────────────────────

export async function openExit(payload: ExitInput): Promise<R> {
  const p = exitInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const v = p.data;
  const who = splitPersonKey(v.person);
  const s = await createClient();
  const { data, error } = await s.rpc("lc_open_exit", {
    p_staff: who.staff_id,
    p_worker: who.worker_id,
    p_type: v.separation_type,
    p_notice_date: v.notice_date,
    p_lwd: v.last_working_day,
    p_reason: v.reason,
    p_grounds: v.grounds || null,
    p_notice_waived: v.notice_waived,
  });
  if (error) return bad(dbMessage(error, "Could not open the exit"));
  const id = data as string;
  if (v.separation_type === "termination") notifyStarted(WORKFLOWS.lc_termination.subjectTable, id);
  revalidateLifecycle();
  return { ok: true, id };
}

export async function loadExitSteps(id: string): Promise<ExitStep[]> {
  return getExitSteps(id).catch(() => []);
}

export async function loadExitPanel(id: string) {
  return getApprovalPanel(WORKFLOWS.lc_termination.subjectTable, id);
}

export async function tickExitStep(stepId: string, done: boolean, note: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("lc_tick_exit_step", { p_step: stepId, p_done: done, p_note: note || null });
  if (error) return bad(dbMessage(error, "Could not update the step"));
  revalidateLifecycle();
  return { ok: true };
}

export async function withdrawExit(id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("lc_withdraw_exit", { p_id: id, p_reason: reason });
  if (error) return bad(dbMessage(error, "Could not withdraw"));
  revalidateLifecycle();
  return { ok: true };
}

export async function completeExit(id: string, markLeft: boolean): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("lc_complete_exit", { p_id: id, p_mark_left: markLeft });
  if (error) return bad(dbMessage(error, "Could not complete the exit"));
  revalidateLifecycle();
  revalidatePath("/hr/staff");
  revalidatePath("/hr/workers");
  return { ok: true };
}

export async function saveExitStep(key: string | null, payload: { key: string; label: string; sort_order: number; is_active: boolean }): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const label = payload.label.trim().toUpperCase();
  if (!label) return bad("The step needs a name");
  const s = await createClient();
  if (key) {
    const { error } = await s
      .from("lc_exit_step_catalog")
      .update({ label, sort_order: payload.sort_order, is_active: payload.is_active })
      .eq("key", key);
    if (error) return bad(dbMessage(error, "Could not save"));
  } else {
    const newKey =
      payload.key.trim().toLowerCase() ||
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/^(\d)/, "s_$1")
        .slice(0, 40);
    if (!/^[a-z][a-z0-9_]*$/.test(newKey)) return bad("Give the step a name that starts with a letter");
    const { error } = await s
      .from("lc_exit_step_catalog")
      .insert({ key: newKey, label, sort_order: payload.sort_order, is_active: payload.is_active });
    if (error) return bad(error.code === "23505" ? "A step with this name already exists" : dbMessage(error, "Could not save"));
  }
  revalidateLifecycle();
  return { ok: true };
}

export async function saveLcSettings(payload: SettingsInput): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  const p = settingsInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("lc_settings").update(p.data).eq("id", true);
  if (error) return bad(dbMessage(error, "Could not save the settings"));
  revalidateLifecycle();
  return { ok: true };
}

// ─── Full & final ──────────────────────────────────────────────────────────

export async function loadSettlementPrefill(exitId: string): Promise<{ ok: true; prefill: SettlementPrefill } | { ok: false; error: string }> {
  const s = await createClient();
  const { data, error } = await s.rpc("lc_settlement_prefill", { p_exit: exitId });
  if (error) return { ok: false, error: dbMessage(error, "Could not read the figures") };
  const d = data as Record<string, unknown>;
  const n = (k: string) => (d[k] == null ? 0 : Number(d[k]));
  return {
    ok: true,
    prefill: {
      rated: d.rated === "daily" ? "daily" : "monthly",
      basic_da: n("basic_da"),
      daily_wage: n("daily_wage"),
      joined_on: (d.joined_on as string | null) ?? null,
      last_working_day: d.last_working_day as string,
      separation_type: d.separation_type as SettlementPrefill["separation_type"],
      leave_days: n("leave_days"),
      advance_recovery: n("advance_recovery"),
      asset_recovery: n("asset_recovery"),
      notice_required: n("notice_required"),
      notice_short_days: n("notice_short_days"),
      gratuity_min_years: n("gratuity_min_years"),
      gratuity_cap: n("gratuity_cap"),
    },
  };
}

export async function saveSettlement(exitId: string, draft: SettlementDraft): Promise<R> {
  const s = await createClient();
  const { data, error } = await s.rpc("lc_save_settlement", {
    p_exit: exitId,
    p: { ...draft, joined_on: draft.joined_on || null },
  });
  if (error) return bad(dbMessage(error, "Could not save the settlement"));
  revalidateLifecycle();
  return { ok: true, id: data as string };
}

export async function submitSettlement(id: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("lc_submit_settlement", { p_id: id });
  if (error) return bad(dbMessage(error, "Could not send it for approval"));
  notifyStarted(WORKFLOWS.lc_settlement.subjectTable, id);
  revalidateLifecycle();
  return { ok: true };
}

export async function recallSettlement(id: string, reason: string): Promise<R> {
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { error } = await s.rpc("lc_recall_settlement", { p_id: id, p_reason: reason });
  if (error) return bad(dbMessage(error, "Could not recall"));
  revalidateLifecycle();
  return { ok: true };
}

export async function markSettlementPaid(id: string, ref: string): Promise<R> {
  const s = await createClient();
  const { error } = await s.rpc("lc_mark_settlement_paid", { p_id: id, p_ref: ref });
  if (error) return bad(dbMessage(error, "Could not mark it paid"));
  revalidateLifecycle();
  return { ok: true };
}

export async function loadSettlementPanel(id: string) {
  return getApprovalPanel(WORKFLOWS.lc_settlement.subjectTable, id);
}
