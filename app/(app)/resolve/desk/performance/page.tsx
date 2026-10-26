import { PageHeader } from "@/components/ui/page-header";
import { DeskPerformanceScreen } from "@/components/resolve/desk/desk-performance-screen";
import { isCalendarDate, startOfMonth, startOfWeek, today } from "@/lib/calendar";
import { requireRh } from "@/lib/resolve/auth";
import { getDeskPerformance } from "@/lib/resolve/desk-service";

type Search = { from?: string; to?: string };

/** `YYYY-MM-DD` off the query string, or the fallback — fed to the query,
 *  never formatted (AGENTS "Dates"). */
function day(raw: string | undefined, fallback: string): string {
  return raw && isCalendarDate(raw) ? raw : fallback;
}

// Technician performance is analytics (resolve:export, plan §1.10);
// `rh_sd_performance` refuses anyone else on its own.
export default async function DeskPerformancePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRh("analytics");
  const sp = await searchParams;
  // Business-local today (lib/calendar), so "this month" is never a UTC day behind.
  const t = today();
  let from = day(sp.from, startOfMonth(t));
  let to = day(sp.to, t);
  if (from > to) [from, to] = [to, from];
  const rows = await getDeskPerformance(from, to);
  // The chips' ranges, from the same server-side today — a phone whose clock
  // is off must not shift "This week".
  const presets = { week: { from: startOfWeek(t), to: t }, month: { from: startOfMonth(t), to: t } };
  return (
    <div className="space-y-4">
      <PageHeader title="Performance" description="Response, resolution, SLA met and CSAT per technician — tickets resolved in the range" />
      <DeskPerformanceScreen key={`${from}|${to}`} from={from} to={to} rows={rows} presets={presets} />
    </div>
  );
}
