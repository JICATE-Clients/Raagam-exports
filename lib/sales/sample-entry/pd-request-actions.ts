"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import type { PdRequestState } from "./types";

/**
 * PRODUCT DEVELOPMENT REQUEST & ACKNOWLEDGEMENT (0719, client brief
 * 2026-10-13 §3; doc/sample/sample-module-specification.md §7.1).
 *
 * "Upon saving Sample Entry, the merchandiser submits a Product Development
 * Request to the Sampling Department … which reviews technical feasibility and
 * updates status (Acknowledged / Not Acknowledged), notifying merchandising."
 *
 * The Sample Department answers in the approvals inbox — Approve is
 * Acknowledged, Reject (reason mandatory) is Not Acknowledged — and the engine
 * already tells the merchandiser either way. One request open per enquiry; a
 * Not Acknowledged one may be followed by a new one, and both stay on record.
 *
 * It is a request on its own table, so a LOCKED sample (costing approved,
 * 0716) can still be sent one.
 */

type Result = { ok: true } | { ok: false; error: string };

const PATH = "/sales/sample-entry";

export async function sendPdRequest(opportunityId: string, note: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Sending a PD Request needs Sample ▸ Edit." };
  const s = await createClient();
  const { data: opp, error } = await s
    .from("opportunities")
    .select("id, code, is_draft, customer:customers!customer_id(name), styles(sample_qty)")
    .eq("id", opportunityId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  type Row = {
    id: string;
    code: string | null;
    is_draft: boolean | null;
    customer: { name: string | null } | { name: string | null }[] | null;
    styles: { sample_qty: number | string | null }[] | null;
  };
  const row = opp as unknown as Row | null;
  if (!row) return { ok: false, error: "That sample entry no longer exists." };
  if (row.is_draft || !row.code) {
    return { ok: false, error: "Save the sample entry (it takes its SMP number then) before sending the PD Request." };
  }
  const pieces = (row.styles ?? []).reduce((t, x) => t + (Number(x.sample_qty) || 0), 0);
  if (!(row.styles ?? []).length) return { ok: false, error: "Add the sample's styles before sending the PD Request." };

  const { data: req, error: insErr } = await s
    .from("sample_pd_requests")
    .insert({ opportunity_id: opportunityId, note: note.trim() || null })
    .select("id")
    .single();
  if (insErr || !req) {
    return {
      ok: false,
      error:
        insErr?.code === "23505"
          ? "A PD Request for this sample is already with the Sample Department."
          : (insErr?.message ?? "Could not send the PD Request."),
    };
  }

  const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer;
  const started = await startApproval({
    workflowKey: WORKFLOWS.sample_pd_request.key,
    subjectTable: WORKFLOWS.sample_pd_request.subjectTable,
    subjectId: req.id,
    // Every key a flow might test; a missing key falls to the catch-all.
    context: { smp_no: row.code, customer: cust?.name ?? null, styles: (row.styles ?? []).length, sample_pieces: pieces },
  });
  if (!started.ok) {
    // 0719's delete policy allows exactly this: the sender's own request that
    // no approver holds. A request in nobody's queue would block the next one.
    await s.from("sample_pd_requests").delete().eq("id", req.id);
    return { ok: false, error: `The PD Request could not be routed — ${started.error}` };
  }

  await writeAudit({ action: "sample_pd_request.sent", entityType: "opportunity", entityId: opportunityId });
  revalidatePath(PATH);
  return { ok: true };
}

/** The latest PD Request on one enquiry, or null when none was sent. */
export async function getPdRequest(opportunityId: string): Promise<PdRequestState | null> {
  if (!(await can("sales", "view"))) return null;
  const s = await createClient();
  const { data } = await s
    .from("sample_pd_requests")
    .select("id, status, note, decision_remark, decided_at, created_at")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PdRequestState | null) ?? null;
}
