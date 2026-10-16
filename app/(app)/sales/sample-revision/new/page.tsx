import { requirePermission } from "@/lib/auth/server";
import { listPlanApprovals } from "@/lib/sales/plan-reports/service";
import { RaisePlanRevisionScreen } from "./raise-plan-revision-screen";

/**
 * Sample ▸ Revision ▸ Raise Revision — the door, as a page, after Orders ▸
 * Order Revisions ▸ Raise Revision (user 2026-10-14). `?plan=<kind>:<plan id>`
 * pre-picks a row's SWO and ticks its plan (the register's Revise icon).
 * Raising reopens a work-order plan, so it answers to Orders ▸ Edit — the
 * permission `raiseFabricPlanRevision` / `raiseAccessoriesPlanRevision` check.
 */
export const metadata = { title: "Raise Revision" };

export default async function RaisePlanRevisionPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  await requirePermission("orders", "edit");
  const [{ plan }, plans] = await Promise.all([searchParams, listPlanApprovals()]);
  return <RaisePlanRevisionScreen plans={plans} initialPlanKey={plan ?? null} />;
}
