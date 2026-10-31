import { requirePermission } from "@/lib/auth/server";
import { filterHrDashboard, getHrDashboard } from "@/lib/hr/dashboard-service";
import { HrDashboardFilter } from "@/components/hr/dashboard-filter";
import type { PersonKind } from "@/lib/masters/category-timing-types";
import { HrDashboardView } from "./hr-dashboard";

/**
 * HR ▸ Dashboard (client 2026-10-28): today's attendance, Staff and Worker
 * (0774: each person judged by their category's hours), who is late, out or gone early, every
 * punch between In and Out, the week's trend and the devices.
 *
 * Its own row, FIRST in the HR sidebar above People (client: "there should be
 * heading as dashboard"). Not the module root itself — a row pointing at /hr
 * is the "module repeated as its own first child" AGENTS.md bans — but being
 * the first entry, `ModuleHub` on /hr sends the module row here anyway.
 *
 * "Now" is read once, on the server, and handed down: the view never reaches
 * for a viewer's clock, and every figure answers for the same instant.
 *
 * One side at a time, Staff or Worker, narrowed to any of its departments
 * (user 2026-10-31) — `?kind=` and `?dept=` in the URL, applied here.
 */
export default async function HrDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; dept?: string }>;
}) {
  await requirePermission("hr_payroll", "view");
  const sp = await searchParams;
  const kind: PersonKind = sp.kind === "worker" ? "worker" : "staff";
  const depts = (sp.dept ?? "")
    .split(",")
    .filter(Boolean)
    .map((d) => (d === "none" ? "" : d));

  const now = new Date().getTime();
  const full = await getHrDashboard(now);
  const view = filterHrDashboard(full, { kind, depts });
  const counts = {
    staff: full.groups.find((g) => g.group === "staff")?.people.length ?? 0,
    worker: full.groups.find((g) => g.group === "worker")?.people.length ?? 0,
  };

  return (
    <HrDashboardView
      data={view.data}
      weekNote={
        view.picked.length > 0 && !full.trendByDept
          ? "The week shows every department until migration 0776 is applied."
          : undefined
      }
      filter={<HrDashboardFilter kind={kind} counts={counts} depts={view.depts} picked={view.picked} />}
    />
  );
}
