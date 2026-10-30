import { requirePermission } from "@/lib/auth/server";
import { getHrDashboard } from "@/lib/hr/dashboard-service";
import { HrDashboardView } from "./hr-dashboard";

/**
 * HR ▸ Dashboard (client 2026-10-28): today's attendance by timing group
 * (Staff · Security · Production Staff), who is late, out or gone early, every
 * punch between In and Out, the week's trend and the devices.
 *
 * Its own row, FIRST in the HR sidebar above People (client: "there should be
 * heading as dashboard"). Not the module root itself — a row pointing at /hr
 * is the "module repeated as its own first child" AGENTS.md bans — but being
 * the first entry, `ModuleHub` on /hr sends the module row here anyway.
 *
 * "Now" is read once, on the server, and handed down: the view never reaches
 * for a viewer's clock, and every figure answers for the same instant.
 */
export default async function HrDashboardPage() {
  await requirePermission("hr_payroll", "view");
  const now = new Date().getTime();
  const data = await getHrDashboard(now);
  return <HrDashboardView data={data} />;
}
