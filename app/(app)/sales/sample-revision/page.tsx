import { redirect } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { listPlanApprovals } from "@/lib/sales/plan-reports/service";
import { listSampleRevisions } from "@/lib/sales/sample-revisions/service";
import { PlanRevisionListScreen } from "./plan-revision-list-screen";

/**
 * Sample ▸ Revision — FABRIC PLAN AND ACCESSORIES PLAN REVISIONS ONLY (user
 * 2026-10-14: "for fabric and accessories plan approval revision only, not for
 * SMP"). The register lists the plans Plan Approval approved, and those with a
 * revision under way; Raise Revision reopens one (0718 / 0720 / 0727).
 *
 * SMP revisions (0716) are no longer raised here. What stays reachable:
 * `/sales/sample-revision/<id>` — an SMP revision already raised, which the
 * approvals inbox links to and which must still be finishable — and
 * `?raise=<sample>`, which lands on that sample's OPEN revision when it has one.
 */
export const metadata = { title: "Revision" };

export default async function SampleRevisionPage({ searchParams }: { searchParams: Promise<{ raise?: string }> }) {
  await requirePermission("sales", "view");
  const { raise } = await searchParams;
  if (raise) {
    const open = (await listSampleRevisions()).find((r) => r.opportunity_id === raise && (r.status === "draft" || r.status === "pending"));
    if (open) redirect(`/sales/sample-revision/${open.id}`);
  }
  const [plans, canRaise] = await Promise.all([listPlanApprovals(), can("orders", "edit")]);
  // Approved plans, and every plan a revision has reopened (revision number > 0).
  const rows = plans.filter((r) => r.status === "approved" || r.revisionNo > 0);
  return <PlanRevisionListScreen rows={rows} canRaise={canRaise} />;
}
