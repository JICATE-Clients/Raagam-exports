import { PageHeader } from "@/components/ui/page-header";
import { AnalyticsView } from "@/components/resolve/analytics/analytics-view";
import { requireRh } from "@/lib/resolve/auth";
import { getAnalytics } from "@/lib/resolve/service";

export default async function ResolveAnalyticsPage() {
  await requireRh("analytics");
  const data = await getAnalytics(12);
  return (
    <div className="space-y-4">
      <PageHeader title="Analytics" description="This unit's broken reports — how many, how fast, and what keeps breaking" />
      <AnalyticsView data={data} />
    </div>
  );
}
