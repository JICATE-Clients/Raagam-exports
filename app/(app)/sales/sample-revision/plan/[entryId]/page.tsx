import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { loadPlanReview } from "@/lib/sales/plan-reports/actions";
import { getPlanRevisionEntry } from "@/lib/sales/plan-revisions/service";
import { PlanRevisionOverview, type PlanSide } from "./overview-screen";

/**
 * Sample ▸ Revision ▸ one revision — the WORKSPACE's Overview (Orders ▸ Order
 * Revisions' `[entryId]` page, for the two sample plans): where the revision
 * stands, what each reopened plan changed against what was approved, the
 * approval trail, Send for Approval, and Abandon. Each plan it reopened has a
 * tab beside this one hosting the plan's own editor.
 *
 * `?abandon=1` — the register's Abandon icon — opens the confirm step here.
 * A `[id]` route: its tables are part of a document, not listings.
 */
export const metadata = { title: "Revision" };

export default async function PlanRevisionOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ entryId: string }>;
  searchParams: Promise<{ abandon?: string }>;
}) {
  await requirePermission("sales", "view");
  const [{ entryId }, { abandon }] = await Promise.all([params, searchParams]);
  const [plans, canEdit] = await Promise.all([getPlanRevisionEntry(entryId), can("orders", "edit")]);
  if (!plans.length) notFound();
  /* A plan's report and approval trail are THIS revision's only while the plan
     is still in it; a plan the revision no longer holds (abandoned) has
     nothing of its own to show. */
  const sides: PlanSide[] = await Promise.all(
    plans.map(async (p): Promise<PlanSide> => {
      if (p.status === "abandoned" || p.planRevisionNo !== p.revisionNo) return { report: null, timeline: [], names: {} };
      const r = await loadPlanReview(p.kind, p.bomId);
      return { report: r.report, timeline: r.timeline, names: r.names };
    }),
  );
  return <PlanRevisionOverview plans={plans} sides={sides} canEdit={canEdit} askAbandon={abandon === "1"} />;
}
