import { can, requirePermission } from "@/lib/auth/server";
import { listPlanApprovals } from "@/lib/sales/plan-reports/service";
import type { PlanKind } from "@/lib/sales/plan-reports/types";
import { PlanApprovalScreen } from "./plan-approval-screen";

/**
 * SAMPLE ▸ PLAN APPROVAL (user 2026-10-13: "how we have separate approval
 * screen in order entry, we need separate screen for this also").
 *
 * Order Budget Approval's screen for the two sample plans, piece for piece:
 * the register (Pending · Updated · Draft box, search, Filters panel; Report ·
 * Request Rework · Approve on each row), and one plan opened full-page in the
 * order page's three columns — the plan's identity with its full report and
 * a direct link to the plan, the figures it buys, the trail and what a
 * revision changed — with Approve / Request Rework in the header. The approvals inbox's rows land here (`WORKFLOWS`
 * `sample_fabric_plan` / `sample_accessories_plan`, `?open=<kind>:<plan>`).
 */
export const metadata = { title: "Plan Approval" };

export default async function PlanApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  await requirePermission("sales", "view");
  const [rows, sp, canApprove] = await Promise.all([listPlanApprovals(), searchParams, can("approvals", "approve")]);
  const open = typeof sp.open === "string" && rows.some((r) => r.key === sp.open) ? sp.open : null;
  /* WHICH QUEUE OPENS (user 2026-10-14: one queue per plan) — the one asked
     for (`?plan=`), else the plan a deep link names (the approvals inbox's
     `?open=<kind>:<plan>`), else the one with work waiting, Fabric first. */
  const pending = (k: PlanKind) => rows.some((r) => r.kind === k && r.status === "submitted");
  const initialKind: PlanKind =
    sp.plan === "fabric" || sp.plan === "accessories"
      ? sp.plan
      : open
        ? (open.split(":")[0] as PlanKind)
        : !pending("fabric") && pending("accessories")
          ? "accessories"
          : "fabric";
  return <PlanApprovalScreen rows={rows} canApprove={canApprove} initialOpen={open} initialKind={initialKind} />;
}
