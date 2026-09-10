"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";

/**
 * Writes for the Approvals Worklist (doc/approval.md §4). Same shape as
 * `lib/ta/worklist-actions.ts`: no RPC, straight PostgREST through the user's
 * own session, RLS is the actual guard and `can()` is the courteous half.
 *
 * `markSent`/`markApproved` are targeted updates, same as
 * `completeTaActivity`. `markRework` is the one action that is more than
 * that — see its own header.
 */

type Result = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/orders/ta-followup";
const TABLE = "garment_order_amendment_ta_approvals";
const HISTORY_TABLE = "garment_order_amendment_ta_approval_history";

/**
 * Dispatch Proof Enforcement (spec §4.1/§6). The screen already hides the
 * no-file "Mark Sent" button once `requiresProof` is true, but that is only
 * the courtesy half — same rule as every mandatory-field check in this app
 * ("Duplicates" ▸ AGENTS.md: "the screen check is a courtesy; this one is the
 * guard"). Re-read `requires_proof` from the row's own approval here rather
 * than trusting a client-passed flag, so a stale or tampered client can't
 * skip it.
 */
export async function markApprovalSent(
  id: string,
  sentDate?: string,
  proof?: { path: string; mimeType: string | null; sizeBytes: number | null },
): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No approval given" };
  const date = sentDate?.trim() || today();

  const s = await createClient();

  if (!proof) {
    const { data: row, error: readError } = await s
      .from(TABLE)
      .select("approval:ta_approvals(requires_proof)")
      .eq("id", id)
      .maybeSingle();
    if (readError) return { ok: false, error: readError.message };
    const requiresProof = !!(Array.isArray(row?.approval) ? row?.approval[0] : row?.approval)?.requires_proof;
    if (requiresProof) {
      return { ok: false, error: "A proof file is required before this approval can be marked sent" };
    }
  }

  const patch: Record<string, unknown> = { actual_sent_date: date, status: "sent" };
  if (proof) {
    patch.proof_path = proof.path;
    patch.mime_type = proof.mimeType;
    patch.size_bytes = proof.sizeBytes;
  }
  const { error } = await s.from(TABLE).update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function markApprovalApproved(id: string, receivedDate?: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No approval given" };
  const date = receivedDate?.trim() || today();

  const s = await createClient();
  const { error } = await s
    .from(TABLE)
    .update({ actual_received_date: date, status: "approved" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/**
 * Reject a submission — freeze it as a version in the history archive, then
 * reset the live row for the next attempt (doc/approval.md §4.2).
 *
 * REMARKS ARE MANDATORY, refused with no write at all if blank — the same
 * "one declaration, no half-record" rule every other required field in this
 * app follows, applied at the action layer because this is a two-step write
 * with no client-side `<Field required>` of its own to hold the cursor.
 *
 * Two writes, not wrapped in an explicit transaction: Supabase's JS client
 * has no multi-statement transaction primitive, and a Postgres RPC would be
 * the correct fix if the two are ever observed to disagree. The insert runs
 * FIRST and the update only if it succeeds, so a failure here leaves the live
 * row exactly as it was — never versioned-forward with no history to show
 * for it.
 */
export async function markApprovalRework(
  id: string,
  receivedDate: string | undefined,
  remarks: string,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No approval given" };
  if (!remarks.trim()) {
    return { ok: false, error: "Remarks are required to record a rework" };
  }
  const date = receivedDate?.trim() || today();

  const s = await createClient();
  const { data: liveRow, error: readError } = await s
    .from(TABLE)
    .select(
      "id, amendment_id, approval_id, active_version, target_date, actual_sent_date, proof_path, mime_type, size_bytes",
    )
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!liveRow) return { ok: false, error: "That approval row no longer exists" };

  const { error: historyError } = await s.from(HISTORY_TABLE).insert({
    source_row_id: liveRow.id,
    amendment_id: liveRow.amendment_id,
    approval_id: liveRow.approval_id,
    version: liveRow.active_version,
    target_date: liveRow.target_date,
    actual_sent_date: liveRow.actual_sent_date,
    actual_received_date: date,
    proof_path: liveRow.proof_path,
    mime_type: liveRow.mime_type,
    size_bytes: liveRow.size_bytes,
    status: "rework",
    remarks: remarks.trim(),
  });
  if (historyError) return { ok: false, error: historyError.message };

  const { error: updateError } = await s
    .from(TABLE)
    .update({
      active_version: liveRow.active_version + 1,
      actual_sent_date: null,
      actual_received_date: null,
      proof_path: null,
      mime_type: null,
      size_bytes: null,
      status: "pending",
    })
    .eq("id", id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export interface ApprovalHistoryEntry {
  version: number;
  targetDate: string | null;
  actualSentDate: string | null;
  actualReceivedDate: string | null;
  remarks: string | null;
  archivedAt: string;
}

/** Read-only — the "History" link on a row with `activeVersion > 1`. */
export async function getApprovalHistory(sourceRowId: string): Promise<ApprovalHistoryEntry[]> {
  if (!(await can("orders", "view"))) return [];
  const s = await createClient();
  const { data } = await s
    .from(HISTORY_TABLE)
    .select("version, target_date, actual_sent_date, actual_received_date, remarks, archived_at")
    .eq("source_row_id", sourceRowId)
    .order("version", { ascending: true });
  return (data ?? []).map((r) => ({
    version: r.version,
    targetDate: r.target_date,
    actualSentDate: r.actual_sent_date,
    actualReceivedDate: r.actual_received_date,
    remarks: r.remarks,
    archivedAt: r.archived_at,
  }));
}
