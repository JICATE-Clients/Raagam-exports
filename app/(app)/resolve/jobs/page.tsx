import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { JobsScreen } from "@/components/resolve/work/jobs-screen";
import { canRh } from "@/lib/resolve/auth";
import { listJobs, listPeople, listTrades } from "@/lib/resolve/service";

// Triage OR analytics may open All Jobs (plan §9); requireRh takes one key, so
// the either-or is checked here and the page falls back to the module hub.
export default async function JobsPage() {
  const [canTriage, canAnalytics] = await Promise.all([canRh("triage"), canRh("analytics")]);
  if (!canTriage && !canAnalytics) redirect("/resolve");
  const [{ rows, counts }, trades, people] = await Promise.all([
    listJobs(),
    listTrades({ includeInactive: true }),
    canTriage ? listPeople() : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="All Jobs" description="Every broken report in this unit, oldest first" />
      <JobsScreen
        rows={rows}
        counts={counts}
        trades={trades.map((t) => ({ id: t.id, name: t.name }))}
        people={people}
        canAssign={canTriage}
        canExport={canAnalytics}
      />
    </div>
  );
}
