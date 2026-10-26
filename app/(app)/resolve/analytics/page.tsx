import { PageHeader } from "@/components/ui/page-header";
import { ANALYTICS_WEEKS, AnalyticsView, type AnalyticsPeriod } from "@/components/resolve/analytics/analytics-view";
import { addDays, startOfWeek, today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { requireRh } from "@/lib/resolve/auth";
import { getAnalytics } from "@/lib/resolve/service";

type Search = { period?: string };

const isPeriod = (v: string | undefined): v is AnalyticsPeriod => !!v && v in ANALYTICS_WEEKS;

export default async function ResolveAnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRh("analytics");
  const sp = await searchParams;
  // 12 weeks stays the default — what the page always showed.
  const period: AnalyticsPeriod = isPeriod(sp.period) ? sp.period : "12w";
  const weeks = ANALYTICS_WEEKS[period];
  const data = await getAnalytics(weeks);
  // `rh_analytics` starts at the Monday `weeks − 1` weeks back (unit time);
  // said on screen so "This week" on a Monday is not mistaken for seven days.
  const since = fmtDate(addDays(startOfWeek(today()), -7 * (weeks - 1)));
  return (
    <div className="space-y-4">
      <PageHeader title="Analytics" description="This unit's broken reports — how many, how fast, and what keeps breaking" />
      <AnalyticsView data={data} period={period} since={since} />
    </div>
  );
}
