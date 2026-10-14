"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getApprovalPanel, startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";

/**
 * SAMPLE FABRIC PLAN APPROVAL (0718, client brief 2026-10-13 §2).
 *
 * A sample plan is approved before its yarn is bought or its fabric processed
 * (`iwoCeilingRefusal` and `raiseIwoDyeingOrder` refuse until then), and an
 * approved plan is LOCKED in the database — changed only by Raise Revision,
 * which reopens it as the next revision and pauses purchasing until it is
 * approved again. The approver sends a plan back with "Request Rework"; it is
 * then editable and is submitted again.
 *
 * Only a SAMPLE work order's plan is submitted. Orders ▸ IWO Fabric Plan is
 * unchanged: its plans stay `open` and buy against the saved plan as before.
 */

type Result = { ok: true } | { ok: false; error: string };

const PATHS = ["/sales/sample-fabric-plan", "/sales/plan-approval", "/orders/iwo-fabric-bom"];
const revalidate = () => PATHS.forEach((p) => revalidatePath(p));

/**
 * Send a saved sample plan to the approver.
 *
 * Refused while it is a draft, has no yarn to buy, or has a yarn whose
 * purchase weight could not be worked out — the approver is asked to approve
 * yarn KILOS, and a plan that cannot state them has nothing to approve.
 *
 * THE STATUS AND THE RUN ARE ONE STEP (the IWO Budget's rule): a failed
 * `startApproval` puts the plan back to open — 0718's guard allows exactly
 * that move while no run holds it — because a submitted plan in nobody's
 * queue is locked with no way out.
 */
export async function submitSampleFabricPlan(bomId: string): Promise<Result> {
  // nav-path: exempt -- "Orders ▸ Edit" names the permission, not a menu row
  if (!(await can("orders", "edit"))) return { ok: false, error: "Submitting a Fabric Plan needs Orders ▸ Edit." };
  const s = await createClient();
  const { data, error } = await s
    .from("iwo_fabric_boms")
    .select(
      "id, iwo_id, is_draft, approval_status, revision_no, location_id, " +
        "iwo:internal_work_orders(code, is_sample), " +
        "yarns:iwo_fabric_bom_yarns(purchase_qty, refusal_reason, item:items(name))",
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
    yarns: { purchase_qty: number | string | null; refusal_reason: string | null; item: { name: string | null } | null }[];
  };
  const plan = data as unknown as Row | null;
  if (!plan) return { ok: false, error: "That Fabric Plan no longer exists." };
  if (!plan.iwo?.is_sample) return { ok: false, error: "Only a Sample Fabric Plan goes for approval." };
  if (plan.approval_status === "submitted") return { ok: false, error: "This Fabric Plan is already with the approver." };
  if (plan.approval_status === "approved") {
    return { ok: false, error: "This Fabric Plan is already approved. Raise Revision to change it." };
  }
  if (plan.is_draft) return { ok: false, error: "Save the Fabric Plan (not as a draft) before submitting it." };
  if (!plan.yarns.length) {
    return { ok: false, error: "This Fabric Plan has no yarn to buy yet — plan its fabrics first, then submit." };
  }
  const unworked = plan.yarns.find((y) => y.purchase_qty == null);
  if (unworked) {
    const name = unworked.item?.name?.trim() || "A yarn";
    return {
      ok: false,
      error: `${name}: the plan could not work out its purchase weight${unworked.refusal_reason ? ` (${unworked.refusal_reason})` : ""}. Fix it, save, then submit.`,
    };
  }

  const { data: swo } = await s.from("sample_product_groups").select("group_code").eq("iwo_id", plan.iwo_id).maybeSingle();
  const yarnKg = plan.yarns.reduce((sum, y) => sum + (Number(y.purchase_qty) || 0), 0);

  const { error: upErr } = await s
    .from("iwo_fabric_boms")
    .update({
      approval_status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: (await getAppUser())?.id ?? null,
    })
    .eq("id", bomId);
  if (upErr) return { ok: false, error: upErr.message };

  const started = await startApproval({
    workflowKey: WORKFLOWS.sample_fabric_plan.key,
    subjectTable: WORKFLOWS.sample_fabric_plan.subjectTable,
    subjectId: bomId,
    // Every key a flow might test; a missing key falls to the catch-all.
    context: {
      swo_code: (swo as { group_code: string } | null)?.group_code ?? null,
      iwo_code: plan.iwo.code,
      revision_no: plan.revision_no,
      yarn_purchase_kg: Math.round(yarnKg * 1000) / 1000,
    },
    scope: { location_id: plan.location_id },
  });
  if (!started.ok) {
    await s.from("iwo_fabric_boms").update({ approval_status: "open", submitted_at: null, submitted_by: null }).eq("id", bomId);
    return { ok: false, error: `No approval could be started — ${started.error}` };
  }

  await writeAudit({ action: "iwo_fabric_bom.submitted", entityType: "iwo_fabric_bom", entityId: bomId });
  revalidate();
  return { ok: true };
}

/**
 * Reopen an APPROVED plan as its next revision, with the reason (mandatory).
 * `raise_fabric_plan_revision` checks the permission, the unit and the state
 * itself, and records what had been approved before it reopens the plan.
 */
export async function raiseFabricPlanRevision(bomId: string, reason: string): Promise<Result & { revisionNo?: number }> {
  // nav-path: exempt -- "Orders ▸ Edit" names the permission, not a menu row
  if (!(await can("orders", "edit"))) return { ok: false, error: "Raising a Fabric Plan revision needs Orders ▸ Edit." };
  if (!reason.trim()) return { ok: false, error: "Say why the plan is being revised." };
  const s = await createClient();
  const { data, error } = await s.rpc("raise_fabric_plan_revision", { p_bom: bomId, p_reason: reason.trim() });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "iwo_fabric_bom.revision_raised", entityType: "iwo_fabric_bom", entityId: bomId });
  revalidate();
  return { ok: true, revisionNo: data as number };
}

export type FabricPlanRevision = {
  revision_no: number;
  reason: string;
  raised_at: string;
  approved_yarns: { item_id: string; name: string | null; purchase_qty: number | null; uom: string | null }[];
};

/** The approval panel (run, whether this user may act, timeline) and the
 *  revision log, newest first — what the editor's banner reads.
 *
 *  `mine` = this user SENT the live run. The editor never offers the sender a
 *  decision (client 2026-10-14, "after submitting automatically approved"):
 *  a Super Admin's override put a filled Approve exactly where Submit had
 *  just been, and the next click approved their own plan. Deciding is done
 *  from the queue — Sample ▸ Plan Approval. */
export async function getFabricPlanApproval(bomId: string) {
  const empty = { run: null, verdict: null, timeline: [], names: {}, revisions: [] as FabricPlanRevision[], mine: false };
  if (!(await can("orders", "view"))) return empty;
  const s = await createClient();
  const [panel, revs, me] = await Promise.all([
    getApprovalPanel(WORKFLOWS.sample_fabric_plan.subjectTable, bomId),
    s
      .from("iwo_fabric_bom_revisions")
      .select("revision_no, reason, raised_at, approved_yarns")
      .eq("bom_id", bomId)
      .order("revision_no", { ascending: false }),
    getAppUser(),
  ]);
  const mine = !!panel.run && !!me && panel.run.requested_by === me.id;
  return { ...panel, revisions: (revs.data ?? []) as FabricPlanRevision[], mine };
}
