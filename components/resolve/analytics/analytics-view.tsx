import { BarChartMini, ChartEmpty, ChartFrame, ChartLegend, DonutChart } from "@/components/dashboard/charts";
import type { DashboardTone } from "@/lib/dashboard/types";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Stat } from "@/components/ui/stat";
import type { ResolveAnalytics, TicketSource } from "@/lib/resolve/types";

/*
 * Resolve Hub ▸ Analytics — the current unit only (plan §7). Server-rendered
 * with the dashboard's own SVG/CSS chart kit (components/dashboard/charts.tsx),
 * not recharts: nothing here is interactive beyond a hover, and the kit follows
 * the theme tokens.
 *
 * Every rate states its formula on the tile. "Verified" is the word that
 * matters: an owner saying "it's fixed" is not a verified fix, so
 * owner-confirmed closures, cancelled and withdrawn jobs are all outside it.
 *
 * The tables are aggregates with no `created_at`, so `withCreatedColumns`
 * leaves them unchanged — it is called anyway, so the listing rule is visibly met.
 */

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 1000) / 10}%`);
const days = (v: number | null) => (v == null ? "—" : `${Math.round(v * 10) / 10} d`);
/** Axis label — charts stay short (AGENTS "Dates": chart axis labels exempt). */
const weekLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const SOURCE_LABEL: Record<TicketSource, string> = { form: "Form", qr: "QR sticker", ai: "AI-assisted" };
const SOURCE_TONE: Record<TicketSource, DashboardTone> = { form: "primary", qr: "info", ai: "accent" };

type LatePlace = ResolveAnalytics["late_by_place"][number];
type Repeat = ResolveAnalytics["repeats"][number] & { key: string };
type Closer = ResolveAnalytics["top_closers"][number];
type Overdue = ResolveAnalytics["top_overdue"][number];

const latePlaceColumns: Column<LatePlace>[] = [
  { header: "Place", cell: (r) => <span className="text-sm">{r.place_name}</span> },
  { header: "Late", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold text-danger">{r.late}</span> },
];
const repeatColumns: Column<Repeat>[] = [
  { header: "Place", cell: (r) => <span className="text-sm">{r.place_name}</span> },
  { header: "Trade", cell: (r) => <span className="text-sm">{r.trade_name}</span> },
  { header: "Jobs", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{r.count}</span> },
];
const closerColumns: Column<Closer>[] = [
  { header: "Person", cell: (r) => <span className="text-sm">{r.name}</span> },
  { header: "Closed", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{r.closed}</span> },
];
const overdueColumns: Column<Overdue>[] = [
  { header: "Person", cell: (r) => <span className="text-sm">{r.name}</span> },
  { header: "Overdue", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold text-danger">{r.overdue}</span> },
];

export function AnalyticsView({ data }: { data: ResolveAnalytics }) {
  const t = data.totals;
  const sources = data.by_source.filter((s) => s.count > 0);
  const sourceTotal = sources.reduce((n, s) => n + s.count, 0);
  const repeats: Repeat[] = data.repeats.slice(0, 20).map((r, i) => ({ ...r, key: `${i}` }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Reported" value={t.total} hint="Broken reports in range — joins are not counted" />
        <Stat label="Open" value={t.open} hint={`${t.blocked} blocked · ${t.fixed} awaiting a check`} />
        <Stat label="Late" value={t.late} tone={t.late ? "danger" : "neutral"} hint="Past due while open or in progress" />
        <Stat label="Closed" value={t.closed} tone="success" hint={`${t.reopened} reopened · ${t.disputed} disputed`} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Verified fix rate"
          value={pct(data.verified_fix_rate)}
          hint="Closed by fix photo or spot check ÷ (closed − owner-confirmed); cancelled and withdrawn excluded"
        />
        <Stat label="Reopen rate" value={pct(data.reopen_rate)} hint="Reopened ÷ closed" />
        <Stat label="Median days to fix" value={days(data.median_days_to_fix)} hint="Report to fix, paused time left out" />
        <Stat label="Average resolution" value={days(data.avg_resolution_days)} hint="Report to close, paused time left out" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartFrame
          className="lg:col-span-2"
          title="New vs fixed"
          subtitle={`Weekly, last ${data.weekly.length || 12} weeks`}
          aside={
            <ChartLegend
              items={[
                { label: "New", tone: "primary" },
                { label: "Fixed", tone: "success" },
              ]}
            />
          }
        >
          <BarChartMini
            bars={data.weekly.map((w) => ({ label: weekLabel(w.week_start), a: w.created, b: w.fixed }))}
            tones={["primary", "success"]}
            format={(b) => `Week of ${b.label}: ${b.a} new · ${b.b} fixed`}
          />
        </ChartFrame>
        <ChartFrame title="How it was reported" subtitle="Reporting source">
          {sourceTotal ? (
            <DonutChart
              slices={sources.map((s) => ({ label: SOURCE_LABEL[s.source] ?? s.source, count: s.count, tone: SOURCE_TONE[s.source] ?? "info" }))}
              total={sourceTotal}
              unit="reports"
            />
          ) : (
            <ChartEmpty>No reports yet.</ChartEmpty>
          )}
        </ChartFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="Late by place" subtitle="Jobs past due, by where they are">
          <DataTable columns={withCreatedColumns(latePlaceColumns, data.late_by_place)} rows={data.late_by_place} getKey={(r) => r.place_id} paginate={false} bare empty="Nothing is late." />
        </ChartFrame>
        <ChartFrame title="Repeated problems" subtitle="Top 20 place × trade pairs">
          <DataTable columns={withCreatedColumns(repeatColumns, repeats)} rows={repeats} getKey={(r) => r.key} paginate={false} bare empty="No place has the same problem twice." />
        </ChartFrame>
        <ChartFrame title="Top closers" subtitle="Most jobs closed">
          <DataTable columns={withCreatedColumns(closerColumns, data.top_closers.slice(0, 5))} rows={data.top_closers.slice(0, 5)} getKey={(r) => r.profile_id} paginate={false} bare empty="Nobody has closed a job yet." />
        </ChartFrame>
        <ChartFrame title="Most overdue" subtitle="Most jobs past due">
          <DataTable columns={withCreatedColumns(overdueColumns, data.top_overdue.slice(0, 5))} rows={data.top_overdue.slice(0, 5)} getKey={(r) => r.profile_id} paginate={false} bare empty="Nobody has an overdue job." />
        </ChartFrame>
      </div>
    </div>
  );
}
