import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { WorkloadTables } from "@/components/resolve/work/workload-tables";
import { canRh } from "@/lib/resolve/auth";
import { getWorkload } from "@/lib/resolve/service";

// Work, triage or analytics (plan §9) — `rh_workload()` scopes the rows itself.
export default async function WorkloadPage() {
  const allowed = await Promise.all([canRh("work"), canRh("triage"), canRh("analytics")]);
  if (!allowed.some(Boolean)) redirect("/resolve");
  const rows = await getWorkload();
  return (
    <div className="space-y-4">
      <PageHeader title="Workload" description="Open, in-progress, blocked and overdue jobs per team and per person" />
      <WorkloadTables rows={rows} />
    </div>
  );
}
