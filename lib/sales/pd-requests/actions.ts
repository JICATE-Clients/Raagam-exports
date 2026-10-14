"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getApprovalPanel, startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { readPdSample } from "./service";

/**
 * Sample ▸ PD Request · Acknowledge PD Request — the actions (types.ts).
 *
 * ONE REQUEST PER SWO (user 2026-10-14; 0723). It used to be raised per SMP
 * from Sample Entry (0719); it is now raised here, after Grouping, on the SWO
 * — even an SWO holding a single sample. Acknowledging is the engine's
 * Approve, made through `ApprovalActionBar`.
 *
 * (No `export type` in this file: a "use server" module that re-exports a type
 * crashes at runtime while tsc passes it.)
 */

type Result = { ok: true } | { ok: false; error: string };

/** The selected SWO's samples — what the SWO No pick fills the form with. */
export async function loadPdSample(groupId: string) {
  if (!(await can("sales", "view"))) return null;
  return readPdSample({ groupId });
}

/**
 * ONE REQUEST FOR REVIEW — the SWO as it stands plus the request's approval
 * panel (run, whether this user may act, the trail). A request 0719 raised per
 * SMP reads that one sample instead.
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
 * SEND THE PD REQUEST FOR ONE SWO. The Sample Department answers in the
 * approvals inbox or on Sample ▸ Acknowledge PD Request — Approve is
 * Acknowledged, Reject (reason mandatory) is Not Acknowledged — and the engine
 * tells the merchandiser either way. One request open per SWO; a Not
 * Acknowledged one may be followed by a new one, and both stay on record.
 */
export async function sendPdRequest(groupId: string, note: string): Promise<Result> {
  // nav-path: exempt -- "Sample ▸ Edit" names the sales:edit PERMISSION, not a menu row.
  if (!(await can("sales", "edit"))) return { ok: false, error: "Sending a PD Request needs Sample ▸ Edit." };
  const s = await createClient();
  const { data: grp, error } = await s
    .from("sample_product_groups")
    .select("id, group_code, items:sample_group_items(style_id, sample_entry_id, style:styles!style_id(sample_qty))")
    .eq("id", groupId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  type Row = {
    id: string;
    group_code: string | null;
    items: { style_id: string; sample_entry_id: string; style: { sample_qty: number | string | null } | null }[] | null;
  };
  const row = grp as unknown as Row | null;
  if (!row) return { ok: false, error: "That SWO no longer exists." };
  const items = row.items ?? [];
  if (!items.length) return { ok: false, error: `${row.group_code ?? "This SWO"} has no samples in it — add them on Sample ▸ Grouping first.` };
  // An item is one fabric of a style; count each style's pieces once.
  const perStyle = new Map(items.map((it) => [it.style_id, Number(it.style?.sample_qty) || 0]));
  const pieces = [...perStyle.values()].reduce((t, x) => t + x, 0);
  const samples = new Set(items.map((it) => it.sample_entry_id)).size;

  const { data: req, error: insErr } = await s
    .from("sample_pd_requests")
    .insert({ group_id: groupId, note: note.trim() || null })
    .select("id")
    .single();
  if (insErr || !req) {
    return {
      ok: false,
      error:
        insErr?.code === "23505"
          ? `A PD Request for ${row.group_code ?? "this SWO"} is already with the Sample Department.`
          : (insErr?.message ?? "Could not send the PD Request."),
    };
  }

  const started = await startApproval({
    workflowKey: WORKFLOWS.sample_pd_request.key,
    subjectTable: WORKFLOWS.sample_pd_request.subjectTable,
    subjectId: req.id,
    // Every key a flow might test; a missing key falls to the catch-all.
    context: { swo_no: row.group_code, samples, styles: perStyle.size, sample_pieces: pieces },
  });
  if (!started.ok) {
    // 0719's delete policy allows exactly this: the sender's own request that
    // no approver holds. A request in nobody's queue would block the next one.
    await s.from("sample_pd_requests").delete().eq("id", req.id);
    return { ok: false, error: `The PD Request could not be routed — ${started.error}` };
  }

  await writeAudit({ action: "sample_pd_request.sent", entityType: "sample_product_group", entityId: groupId });
  revalidatePath("/sales/pd-request");
  revalidatePath("/sales/pd-acknowledge");
  return { ok: true };
}
