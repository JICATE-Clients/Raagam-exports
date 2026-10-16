"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";

/**
 * Sample ▸ Revision — the two writes of a PLAN revision entry (0730). Both are
 * one RPC, so each is one transaction: the database checks the permission,
 * the unit and every plan's state, and refuses the whole call when any plan
 * would refuse. These actions only shape the answer for the screen.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const PATHS = [
  "/sales/sample-revision",
  "/sales/sample-fabric-plan",
  "/sales/sample-accessories-plan",
  "/sales/plan-approval",
  "/orders/iwo-fabric-bom",
  "/orders/iwo-material-bom",
];
const revalidate = () => PATHS.forEach((p) => revalidatePath(p));

/**
 * RAISE ONE REVISION ON AN SWO'S PLANS — the Fabric Plan, the Accessories
 * Plan, or both — with who asked and why. Both or neither: a plan that cannot
 * be reopened (not approved, another unit, its budget locked) refuses the
 * raise for both (`raise_sample_plan_revisions`), so a revision is never left
 * half-open. Answers the entry id, the workspace the screen lands on.
 */
export async function raisePlanRevision(input: {
  fabricBomId: string | null;
  accessoriesBomId: string | null;
  reason: string;
  origin: string;
}): Promise<Result<{ entryId: string }>> {
  // nav-path: exempt -- "Orders ▸ Edit" names the permission, not a menu row
  if (!(await can("orders", "edit"))) return { ok: false, error: "Raising a plan revision needs Orders ▸ Edit." };
  if (!input.fabricBomId && !input.accessoriesBomId) return { ok: false, error: "Tick at least one plan to revise." };
  if (!input.reason.trim()) return { ok: false, error: "Say why the plan is being revised." };
  const s = await createClient();
  const { data, error } = await s.rpc("raise_sample_plan_revisions", {
    p_fabric: input.fabricBomId,
    p_accessories: input.accessoriesBomId,
    p_reason: input.reason.trim(),
    p_origin: input.origin,
  });
  if (error) return { ok: false, error: error.message };
  const out = data as { entry_id: string };
  await writeAudit({ action: "sample_plan_revision.raised", entityType: "sample_plan_revision", entityId: out.entry_id });
  revalidate();
  return { ok: true, entryId: out.entry_id };
}

/**
 * "+ ADD MODULE" — PUT THE SWO'S OTHER PLAN INTO A REVISION ALREADY OPEN (0732,
 * user 2026-10-15: Orders ▸ Order Revisions' option, copied). The plan is raised
 * through the same per-plan raise, joins the entry with its reason and origin, and
 * is refused while the entry is with the approver or already decided
 * (`add_plan_to_sample_revision`). Answers the revision number it took.
 */
export async function addPlanToRevision(entryId: string, kind: "fabric" | "accessories", bomId: string): Promise<Result<{ revisionNo: number }>> {
  // nav-path: exempt -- "Orders ▸ Edit" names the permission, not a menu row
  if (!(await can("orders", "edit"))) return { ok: false, error: "Adding a plan to a revision needs Orders ▸ Edit." };
  const s = await createClient();
  const { data, error } = await s.rpc("add_plan_to_sample_revision", { p_entry: entryId, p_kind: kind, p_bom: bomId });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "sample_plan_revision.plan_added", entityType: "sample_plan_revision", entityId: entryId });
  revalidate();
  return { ok: true, revisionNo: Number(data) || 0 };
}

/**
 * ABANDON A REVISION ENTRY — every plan it reopened goes back exactly as it
 * was approved (0727's snapshot) and locks again; the revision closes as
 * abandoned. Refused while the approver holds it, and for a revision raised
 * before snapshots were kept (`abandon_sample_plan_revision`).
 */
export async function abandonPlanRevision(entryId: string, reason?: string | null): Promise<Result<{ plans: number }>> {
  // nav-path: exempt -- "Orders ▸ Edit" names the permission, not a menu row
  if (!(await can("orders", "edit"))) return { ok: false, error: "Abandoning a plan revision needs Orders ▸ Edit." };
  const s = await createClient();
  const { data, error } = await s.rpc("abandon_sample_plan_revision", { p_entry: entryId, p_reason: reason?.trim() || null });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "sample_plan_revision.abandoned", entityType: "sample_plan_revision", entityId: entryId });
  revalidate();
  return { ok: true, plans: Number(data) || 0 };
}
