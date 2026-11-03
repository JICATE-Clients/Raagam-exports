import { getTrends } from "@/lib/dashboard/service";
import { fmtCompactInr, fmtCompactNumber } from "@/lib/dashboard/format";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import {
  AreaChart,
  BarChartMini,
  ChartEmpty,
  ChartLegend,
  DonutChart,
  ProgressBar,
} from "@/components/dashboard/charts";
import { CellView } from "@/components/dashboard/cards";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { TabbedCard, type CardTab } from "@/components/dashboard/tabbed-card";

/**
 * Section 02 — the trend charts.
 *
 * Every card here is pinned to a trailing twelve months and says so in its
 * subtitle, while the KPIs above follow the range selector. That split is
 * deliberate: the analytics RPCs bucket by month, so a "Today" trend would be a
 * single bar. Stating each card's own period is the honest way to have both.
 */
export async function AnalyticsSection({
  filters,
  caps,
}: {
  filters: DashboardFilters;
  caps: DashboardCaps;
}) {
  const shown = trendTabs(await getTrends(filters, caps));
  if (shown.length === 0) return null;
  return <TabbedCard tabs={shown} label="Trend" icon="trending-up" />;
}

/** The trend charts as tabs — shared by this card and the order book card, which shows
 *  Revenue and Production as its own tabs (one-screen dashboard, 2026-11-03). */
export function trendTabs(t: Awaited<ReturnType<typeof getTrends>>): CardTab[] {
  const yoy = t.revenue.yoy;

  const has = (bars: { a: number; b?: number }[]) => bars.some((x) => x.a > 0 || (x.b ?? 0) > 0);

  // ONE CARD, ONE TAB PER CHART (approved plan v2, 2026-11-02): the seven cards became
  // tabs. A chart with nothing to draw is left out, exactly as its card was (user
  // 2026-10-30: no "No data" boxes), so the tab row only offers what has data.
  const tabs: (CardTab | false)[] = [
    has(t.monthlySales) && {
      key: "intake",
      label: "Order intake",
      subtitle: "Units vs orders · 12 months",
      aside: <ChartLegend items={[{ label: "Units", tone: "primary" }, { label: "Orders", tone: "accent" }]} />,
      body: (
        <BarChartMini
          bars={t.monthlySales}
          format={(b) => `${b.label} · ${fmtCompactNumber(b.a)} pcs · ${fmtCompactNumber(b.b)} orders`}
        />
      ),
    },
    t.orderStatus.total > 0 && {
      key: "status",
      label: "Order status",
      subtitle:
        t.orderStatus.pendingAmendments > 0
          ? `${t.orderStatus.total} open · ${t.orderStatus.pendingAmendments} revising`
          : `${t.orderStatus.total} open, by stage`,
      body: <DonutChart slices={t.orderStatus.slices} total={t.orderStatus.total} unit="orders" />,
    },
    t.revenue.invoiced.some((v) => v > 0) && {
      key: "revenue",
      label: "Revenue",
      subtitle: "Invoiced vs received · 12 months",
      aside:
        yoy != null ? (
          <StatusPill tone={yoy >= 0 ? "success" : "danger"} className="shrink-0">
            {yoy >= 0 ? "+" : ""}
            {yoy.toFixed(1)}% · 6 mo
          </StatusPill>
        ) : undefined,
      body:
        t.revenue.invoiced.length > 1 ? (
          <AreaChart labels={t.revenue.labels} primary={t.revenue.invoiced} secondary={t.revenue.received} />
        ) : (
          <ChartEmpty>No invoices in this period.</ChartEmpty>
        ),
    },
    has(t.productionOutput) && {
      key: "production",
      label: "Production",
      subtitle: "Good vs reject pieces · 12 months",
      aside: <ChartLegend items={[{ label: "Good", tone: "primary" }, { label: "Reject", tone: "danger" }]} />,
      body: (
        <BarChartMini
          bars={t.productionOutput}
          tones={["primary", "danger"]}
          format={(b) => `${b.label} · ${fmtCompactNumber(b.a)} good · ${fmtCompactNumber(b.b)} reject`}
        />
      ),
    },
    t.lineOutput.ok && t.lineOutput.value.length > 0 && {
      key: "lines",
      label: "Lines today",
      subtitle: "Confirmed output per line, today",
      body: (
        <CellView cell={t.lineOutput}>
          {(lines) => (
            <ul className="grid gap-3.5 sm:grid-cols-2">
              {lines.map((l) => (
                <li key={l.name}>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <Truncated text={l.name} className="min-w-0 text-xs" />
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{fmtCompactNumber(l.qty)}</span>
                  </div>
                  <ProgressBar pct={l.pct} tone={l.pct < 40 ? "warning" : "primary"} />
                </li>
              ))}
            </ul>
          )}
        </CellView>
      ),
    },
    has(t.inventory) && {
      key: "inventory",
      label: "Inventory",
      subtitle: "Stock in vs out · 12 months",
      aside: <ChartLegend items={[{ label: "In", tone: "primary" }, { label: "Out", tone: "accent" }]} />,
      body: (
        <BarChartMini bars={t.inventory} format={(b) => `${b.label} · in ${fmtCompactNumber(b.a)} · out ${fmtCompactNumber(b.b)}`} />
      ),
    },
    has(t.purchase) && {
      key: "purchase",
      label: "Purchase",
      // purchase_orders.total_amount is stored in each PO's own currency, so this total
      // mixes them — the /analytics page carries the same caveat.
      subtitle: "PO value, mixed currency · 12 months",
      body: (
        <BarChartMini bars={t.purchase} tones={["accent", "primary"]} format={(b) => `${b.label} · ${fmtCompactInr(b.a)} · ${b.b} POs`} />
      ),
    },
  ];
  return tabs.filter((x): x is CardTab => !!x);
}
