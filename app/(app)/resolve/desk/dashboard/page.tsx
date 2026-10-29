import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { DeskDashboard } from "@/components/resolve/desk/desk-dashboard";
import { canRh } from "@/lib/resolve/auth";
import { getDeskDashboard } from "@/lib/resolve/desk-service";

// Same door as the queue (plan §3 "Access edit or approve or export");
// `rh_sd_dashboard` scopes to the current unit itself.
export default async function DeskDashboardPage() {
  const [canWork, canTriage, canAnalytics] = await Promise.all([canRh("work"), canRh("triage"), canRh("analytics")]);
  if (!canWork && !canTriage && !canAnalytics) redirect("/resolve");
  const data = await getDeskDashboard();
  return (
    <div className="space-y-4">
      <PageHeader title="IT Summary" description="Live IT desk counts, who is carrying what, and what has escalated" />
      <DeskDashboard data={data} />
    </div>
  );
}
