import { getTrends } from "@/lib/dashboard/service";
import { fmtCompactInr, fmtCompactNumber } from "@/lib/dashboard/format";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import {
  AreaChart,
  BarChartMini,
  ChartEmpty,
  ChartFrame,
  ChartLegend,
  DonutChart,
  ProgressBar,
} from "@/components/dashboard/charts";
import { CellView } from "@/components/dashboard/cards";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

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
  const t = await getTrends(filters, caps);

  const yoy = t.revenue.yoy;

  const has = (bars: { a: number; b?: number }[]) => bars.some((x) => x.a > 0 || (x.b ?? 0) > 0);
  const later = [
    t.revenue.invoiced.some((v) => v > 0) && (
      <ChartFrame key="rev"
        title="Revenue"
        subtitle="Invoiced vs received · 12 mo"
        aside={
          yoy != null ? (
            <StatusPill tone={yoy >= 0 ? "success" : "danger"} className="shrink-0">
              {yoy >= 0 ? "+" : ""}
              {yoy.toFixed(1)}% · 6 mo
            </StatusPill>
          ) : undefined
        }
      >
        {t.revenue.invoiced.length > 1 ? (
          <AreaChart
            labels={t.revenue.labels}
            primary={t.revenue.invoiced}
            secondary={t.revenue.received}
          />
        ) : (
          <ChartEmpty>No invoices in this period.</ChartEmpty>
        )}
      </ChartFrame>
    ),
    t.lineOutput.ok && t.lineOutput.value.length > 0 && (
      <ChartFrame key="line"
        title="Line output"
        subtitle="Today"
      >
        <CellView cell={t.lineOutput}>
          {(lines) =>
            lines.length === 0 ? (
              <ChartEmpty>No confirmed output today.</ChartEmpty>
            ) : (
              <ul className="flex flex-col gap-3.5">
                {lines.map((l) => (
                  <li key={l.name}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs">{l.name}</span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                        {fmtCompactNumber(l.qty)}
                      </span>
                    </div>
                    <ProgressBar pct={l.pct} tone={l.pct < 40 ? "warning" : "primary"} />
                  </li>
                ))}
              </ul>
            )
          }
        </CellView>
      </ChartFrame>
    ),
    has(t.productionOutput) && (
      <ChartFrame key="prod" title="Production output" subtitle="Good vs reject · 12 mo">
        <BarChartMini
          bars={t.productionOutput}
          tones={["primary", "danger"]}
          height="sm"
          format={(b) =>
            `${b.label} · ${fmtCompactNumber(b.a)} good · ${fmtCompactNumber(b.b)} reject`
          }
        />
      </ChartFrame>
    ),
    has(t.inventory) && (
      <ChartFrame key="inv" title="Inventory movement" subtitle="In vs out · 12 mo">
        <BarChartMini
          bars={t.inventory}
          height="sm"
          format={(b) =>
            `${b.label} · in ${fmtCompactNumber(b.a)} · out ${fmtCompactNumber(b.b)}`
          }
        />
      </ChartFrame>
    ),
    has(t.purchase) && (
      <ChartFrame key="pur"
        title="Purchase trend"
        // purchase_orders.total_amount is stored in each PO's own currency, so
        // this total mixes them. The existing /analytics page carries the same
        // caveat; better to state it than to imply rupees.
        subtitle="Mixed currency · 12 mo"
      >
        <BarChartMini
          bars={t.purchase}
          tones={["accent", "primary"]}
          height="sm"
          format={(b) => `${b.label} · ${fmtCompactInr(b.a)} · ${b.b} POs`}
        />
      </ChartFrame>
    ),
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartFrame
          title="Order intake"
          subtitle="Units vs orders · 12 mo"
          aside={
            <ChartLegend
              items={[
                { label: "Units", tone: "primary" },
                { label: "Orders", tone: "accent" },
              ]}
            />
          }
        >
          <BarChartMini
            bars={t.monthlySales}
            format={(b) =>
              `${b.label} · ${fmtCompactNumber(b.a)} pcs · ${fmtCompactNumber(b.b)} orders`
            }
          />
        </ChartFrame>

        <ChartFrame
          title="Order status"
          subtitle={
            t.orderStatus.pendingAmendments > 0
              ? `${t.orderStatus.total} open · ${t.orderStatus.pendingAmendments} revising`
              : `${t.orderStatus.total} open`
          }
        >
          <DonutChart
            slices={t.orderStatus.slices}
            total={t.orderStatus.total}
            unit="orders"
          />
        </ChartFrame>
      </div>

      {/* A CHART WITH NOTHING TO DRAW IS LEFT OUT (user 2026-10-30, screenshot
          3859: "No data for this period" boxes read as a broken page). Same
          rule as the headline tiles: absent, never an empty frame. The cards
          that remain share one grid, so a missing one leaves no hole. */}
      {later.length > 0 && (
        <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", later.length >= 3 && "xl:grid-cols-3")}>
          {later}
        </div>
      )}
    </div>
  );
}
