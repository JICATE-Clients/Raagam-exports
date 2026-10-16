"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getApprovalPanel, startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { readPdSample } from "./service";

/**
 * Sample ▸ PD Request · PD Acknowledge — the actions (types.ts).
 *
 * ONE REQUEST PER SMP (user 2026-10-14: "The PD request is for smp not for
 * swo"; 0724). 0723 had moved it onto the SWO the same day; that is reversed.
 * Acknowledging is the engine's Approve, made through `ApprovalActionBar`.
 *
 * (No `export type` in this file: a "use server" module that re-exports a type
 * crashes at runtime while tsc passes it.)
 */

type Result = { ok: true } | { ok: false; error: string };

/** The selected SMP's styles — what the SMP No pick fills the form with. */
export async function loadPdSample(opportunityId: string) {
  if (!(await can("sales", "view"))) return null;
  return readPdSample({ opportunityId });
}

/**
 * ONE REQUEST FOR REVIEW — the SMP as it stands plus the request's approval
 * panel (run, whether this user may act, the trail). The request 0723 raised
 * on an SWO reads that SWO instead.
 */
export async function loadPdReview(requestId: string) {
  const empty = { sample: null, run: null, verdict: null, timeline: [], names: {} as Record<string, string> };
  if (!(await can("sales", "view"))) return empty;
  const s = await createClient();
  const { data } = await s.from("sample_pd_requests").select("group_id, opportunity_id").eq("id", requestId).maybeSingle();
  const req = data as { group_id: string | null; opportunity_id: string | null } | null;
  const subject = req?.group_id ? { groupId: req.group_id } : req?.opportunity_id ? { opportunityId: req.opportunity_id } : null;
  if (!subject) return empty;
  const [sample, panel] = await Promise.all([readPdSample(subject), getApprovalPanel(WORKFLOWS.sample_pd_request.subjectTable, requestId)]);
  return { sample, ...panel };
}

/**
 * SEND THE PD REQUEST FOR ONE SMP. The Sample Department answers in the
 * approvals inbox or on Sample ▸ PD Acknowledge — Approve is
 * Acknowledged, Reject (reason mandatory) is Not Acknowledged — and the engine
 * tells the merchandiser either way. One request open per SMP (0719's index);
 * a Not Acknowledged one may be followed by a new one, and both stay on record.
 * A LOCKED sample (costing approved, 0716) can still be sent one: the request
 * is a row on its own table.
 */
export async function sendPdRequest(opportunityId: string, note: string): Promise<Result> {
  // nav-path: exempt -- "Sample ▸ Edit" names the sales:edit PERMISSION, not a menu row.
  if (!(await can("sales", "edit"))) return { ok: false, error: "Sending a PD Request needs Sample ▸ Edit." };
  const s = await createClient();
  const { data: opp, error } = await s
    .from("opportunities")
    .select("id, code, is_draft, customer:customers!customer_id(name), styles(sample_qty, sample_type)")
    .eq("id", opportunityId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  type Row = {
    id: string;
    code: string | null;
    is_draft: boolean | null;
    customer: { name: string | null } | { name: string | null }[] | null;
    styles: { sample_qty: number | string | null; sample_type: string | null }[] | null;
  };
  const row = opp as unknown as Row | null;
  if (!row) return { ok: false, error: "That sample entry no longer exists." };
  if (row.is_draft || !row.code) {
    return { ok: false, error: "Save the sample entry (it takes its SMP number then) before sending the PD Request." };
  }
  const styles = row.styles ?? [];
  if (!styles.length) return { ok: false, error: `${row.code} has no styles — add them on Sample Entry first.` };
  // SAMPLE TYPE IS MANDATORY: it tells the department which stage to make
  // (Fit, Proto, Size Set …). The request does not invent one; it sends the
  // merchandiser back to Sample Entry, where it is chosen.
  if (styles.some((x) => !(x.sample_type ?? "").trim())) {
    return { ok: false, error: `Set the Sample Type on Sample Entry for ${row.code} before sending the PD Request.` };
  }
  const pieces = styles.reduce((t, x) => t + (Number(x.sample_qty) || 0), 0);

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
          ? `A PD Request for ${row.code} is already with the Sample Department.`
          : (insErr?.message ?? "Could not send the PD Request."),
    };
  }

  const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer;
  const started = await startApproval({
    workflowKey: WORKFLOWS.sample_pd_request.key,
    subjectTable: WORKFLOWS.sample_pd_request.subjectTable,
    subjectId: req.id,
    // Every key a flow might test; a missing key falls to the catch-all.
    context: { smp_no: row.code, customer: cust?.name ?? null, styles: styles.length, sample_pieces: pieces },
  });
  if (!started.ok) {
    // 0719's delete policy allows exactly this: the sender's own request that
    // no approver holds. A request in nobody's queue would block the next one.
    await s.from("sample_pd_requests").delete().eq("id", req.id);
    return { ok: false, error: `The PD Request could not be routed — ${started.error}` };
  }

  await writeAudit({ action: "sample_pd_request.sent", entityType: "opportunity", entityId: opportunityId });
  revalidatePath("/sales/pd-request");
  revalidatePath("/sales/pd-acknowledge");
  return { ok: true };
}
