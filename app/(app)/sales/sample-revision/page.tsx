import { redirect } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { listPlanRevisions } from "@/lib/sales/plan-revisions/service";
import { listSampleRevisions } from "@/lib/sales/sample-revisions/service";
import { PlanRevisionListScreen } from "./plan-revision-list-screen";

/**
 * Sample ▸ Revision — FABRIC PLAN AND ACCESSORIES PLAN REVISIONS ONLY (user
 * 2026-10-14: "for fabric and accessories plan approval revision only, not for
 * SMP"). The register lists every plan revision raised, grouped by SWO; Raise
 * Revision reopens an approved plan (0718 / 0720 / 0727 / 0730), and each
 * revision opens its workspace, `/sales/sample-revision/plan/<entry>`.
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
  const [rows, canRaise] = await Promise.all([listPlanRevisions(), can("orders", "edit")]);
  return <PlanRevisionListScreen rows={rows} canRaise={canRaise} />;
}
