"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getApprovalPanel, startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";

/**
 * SAMPLE ACCESSORIES PLAN APPROVAL (0720) — the Fabric Plan's twin
 * (lib/orders/iwo-fabric-bom/approval-actions.ts), on the trims plan: approved
 * before its trims are bought (`planApprovalRefusal`), locked once submitted,
 * changed only by Raise Revision. Only a SAMPLE work order's plan is
 * submitted; Orders ▸ IWO Accessories Plan is unchanged.
 */

type Result = { ok: true } | { ok: false; error: string };

const PATHS = ["/sales/sample-accessories-plan", "/sales/plan-approval", "/orders/iwo-material-bom"];
const revalidate = () => PATHS.forEach((p) => revalidatePath(p));

/**
 * Send a saved sample Accessories Plan to the approver. Refused while it is a
 * draft, has no line, or has a line whose purchase quantity could not be
 * worked out — the approver approves QUANTITIES, and a plan that cannot state
 * them has nothing to approve. A failed `startApproval` puts it back to open.
 */
export async function submitSampleAccessoriesPlan(bomId: string): Promise<Result> {
  // nav-path: exempt -- "Orders ▸ Edit" names the permission, not a menu row
  if (!(await can("orders", "edit"))) return { ok: false, error: "Submitting an Accessories Plan needs Orders ▸ Edit." };
  const s = await createClient();
  const { data, error } = await s
    .from("iwo_material_boms")
    .select(
      "id, iwo_id, is_draft, approval_status, revision_no, location_id, " +
        "iwo:internal_work_orders(code, is_sample), " +
        "items:iwo_material_bom_items(item_id, purchase_qty, refusal_reason)",
    )
    .eq("id", bomId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  type Row = {
    id: string;
    iwo_id: string;
    is_draft: boolean;
    approval_status: string;
    revision_no: number;
    location_id: string;
    iwo: { code: string | null; is_sample: boolean } | null;
    items: { item_id: string | null; purchase_qty: number | string | null; refusal_reason: string | null }[];
  };
  const plan = data as unknown as Row | null;
  if (!plan) return { ok: false, error: "That Accessories Plan no longer exists." };
  if (!plan.iwo?.is_sample) return { ok: false, error: "Only a Sample Accessories Plan goes for approval." };
  if (plan.approval_status === "submitted") return { ok: false, error: "This Accessories Plan is already with the approver." };
  if (plan.approval_status === "approved") {
    return { ok: false, error: "This Accessories Plan is already approved. Raise Revision to change it." };
  }
  if (plan.is_draft) return { ok: false, error: "Save the Accessories Plan (not as a draft) before submitting it." };
  const lines = plan.items.filter((i) => i.item_id);
  if (!lines.length) return { ok: false, error: "This Accessories Plan has no accessory yet — add its lines, save, then submit." };
  const unworked = lines.find((i) => i.purchase_qty == null);
  if (unworked) {
    return {
      ok: false,
      error: `A line's purchase quantity could not be worked out${unworked.refusal_reason ? ` (${unworked.refusal_reason})` : ""}. Fix it, save, then submit.`,
    };
  }

  const { data: swo } = await s.from("sample_product_groups").select("group_code").eq("accessories_iwo_id", plan.iwo_id).maybeSingle();

  const { error: upErr } = await s
    .from("iwo_material_boms")
    .update({ approval_status: "submitted", submitted_at: new Date().toISOString(), submitted_by: (await getAppUser())?.id ?? null })
    .eq("id", bomId);
  if (upErr) return { ok: false, error: upErr.message };

  const started = await startApproval({
    workflowKey: WORKFLOWS.sample_accessories_plan.key,
    subjectTable: WORKFLOWS.sample_accessories_plan.subjectTable,
    subjectId: bomId,
    // Every key a flow might test; a missing key falls to the catch-all.
    context: {
      swo_code: (swo as { group_code: string } | null)?.group_code ?? null,
      iwo_code: plan.iwo.code,
      revision_no: plan.revision_no,
      lines: lines.length,
    },
    scope: { location_id: plan.location_id },
  });
  if (!started.ok) {
    await s.from("iwo_material_boms").update({ approval_status: "open", submitted_at: null, submitted_by: null }).eq("id", bomId);
    return { ok: false, error: `No approval could be started — ${started.error}` };
  }

  await writeAudit({ action: "iwo_material_bom.submitted", entityType: "iwo_material_bom", entityId: bomId });
  revalidate();
  return { ok: true };
}

/** Reopen an APPROVED plan as its next revision, with the reason (mandatory). */
export async function raiseAccessoriesPlanRevision(bomId: string, reason: string): Promise<Result & { revisionNo?: number }> {
  // nav-path: exempt -- "Orders ▸ Edit" names the permission, not a menu row
  if (!(await can("orders", "edit"))) return { ok: false, error: "Raising an Accessories Plan revision needs Orders ▸ Edit." };
  if (!reason.trim()) return { ok: false, error: "Say why the plan is being revised." };
  const s = await createClient();
  const { data, error } = await s.rpc("raise_accessories_plan_revision", { p_bom: bomId, p_reason: reason.trim() });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "iwo_material_bom.revision_raised", entityType: "iwo_material_bom", entityId: bomId });
  revalidate();
  return { ok: true, revisionNo: data as number };
}

export type AccessoriesPlanRevision = { revision_no: number; reason: string; raised_at: string };

/** The approval panel (run, whether this user may act, timeline) and the
 *  revision log, newest first — what the editor's banner reads. */
export async function getAccessoriesPlanApproval(bomId: string) {
  const empty = { run: null, verdict: null, timeline: [], names: {}, revisions: [] as AccessoriesPlanRevision[] };
  if (!(await can("orders", "view"))) return empty;
  const s = await createClient();
  const [panel, revs] = await Promise.all([
    getApprovalPanel(WORKFLOWS.sample_accessories_plan.subjectTable, bomId),
    s.from("iwo_material_bom_revisions").select("revision_no, reason, raised_at").eq("bom_id", bomId).order("revision_no", { ascending: false }),
  ]);
  return { ...panel, revisions: (revs.data ?? []) as AccessoriesPlanRevision[] };
}
