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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartFrame
          title="Order intake"
          subtitle="units booked vs order count · last 12 months"
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
              ? `${t.orderStatus.total} open · ${t.orderStatus.pendingAmendments} amendment(s) pending`
              : `${t.orderStatus.total} open orders`
          }
        >
          <DonutChart
            slices={t.orderStatus.slices}
            total={t.orderStatus.total}
            unit="orders"
          />
        </ChartFrame>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartFrame
          title="Revenue"
          subtitle="invoiced vs received · last 12 months"
          aside={
            yoy != null ? (
              <span
                className={
                  yoy >= 0
                    ? "inline-flex shrink-0 items-center rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success"
                    : "inline-flex shrink-0 items-center rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-semibold text-danger"
                }
              >
                {yoy >= 0 ? "+" : ""}
                {yoy.toFixed(1)}% vs prior 6 months
              </span>
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

        {/*
          Stands in for the mockup's "Machine Utilisation". There is no machine
          master, no run hours and no downtime capture anywhere in the schema,
          so utilisation cannot be derived at all — output per line is the same
          question answered from data that exists. The subtitle says so.
        */}
        <ChartFrame
          title="Line output"
          subtitle="today · machine-level utilisation isn’t captured"
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
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartFrame title="Production output" subtitle="good vs reject · last 12 months">
          <BarChartMini
            bars={t.productionOutput}
            tones={["primary", "danger"]}
            height="sm"
            format={(b) =>
              `${b.label} · ${fmtCompactNumber(b.a)} good · ${fmtCompactNumber(b.b)} reject`
            }
          />
        </ChartFrame>

        <ChartFrame title="Inventory movement" subtitle="in vs out · last 12 months">
          <BarChartMini
            bars={t.inventory}
            height="sm"
            format={(b) =>
              `${b.label} · in ${fmtCompactNumber(b.a)} · out ${fmtCompactNumber(b.b)}`
            }
          />
        </ChartFrame>

        <ChartFrame
          title="Purchase trend"
          // purchase_orders.total_amount is stored in each PO's own currency, so
          // this total mixes them. The existing /analytics page carries the same
          // caveat; better to state it than to imply rupees.
          subtitle="PO value · mixed currency · last 12 months"
        >
          <BarChartMini
            bars={t.purchase}
            tones={["accent", "primary"]}
            height="sm"
            format={(b) => `${b.label} · ${fmtCompactInr(b.a)} · ${b.b} POs`}
          />
        </ChartFrame>
      </div>
    </div>
  );
}
