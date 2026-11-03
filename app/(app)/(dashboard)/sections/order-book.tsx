import { getLeaderboards, getTrends } from "@/lib/dashboard/service";
import { getBoard } from "@/lib/dashboard/board";
import { today } from "@/lib/dashboard/range";
import { fmtCompactNumber } from "@/lib/dashboard/format";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import { BookSummary, DueByMonth, DueLegend, fmtMoneyShort } from "@/components/dashboard/board";
import { LeaderboardList } from "@/components/dashboard/cards";
import { TabbedCard, type CardTab } from "@/components/dashboard/tabbed-card";
import { PeriodSwitch, periodWords, type Carry } from "@/components/dashboard/hero";
import { CardFooter } from "@/components/dashboard/card-footer";
import { trendTabs } from "./analytics";

/**
 * THE ORDER BOOK CARD — one card, four tabs (one-screen dashboard, user 2026-11-03,
 * plan https://claude.ai/artifact/3vUk4Cth5KjKYAELNGgEiU, decision 2 "approved").
 *
 * Book (when the open book ships) · Revenue · Output · Top buyers. Before this the book
 * chart, a six-tab Trend card and a three-tab Top lists card each took a band of their own,
 * and the dashboard ran about three screens tall. The other trend charts (intake, status,
 * lines, inventory, purchase) and top lists stay on Reports; Buying has its own card here.
 *
 * Each tab's title is the question it answers. A tab with nothing to draw is left out, as
 * the Trend card always did, so the row only offers what has data.
 */
export async function OrderBookSection({ filters, caps, carry }: { filters: DashboardFilters; caps: DashboardCaps; carry: Carry }) {
  const [board, trends, boards] = await Promise.all([
    getBoard(caps),
    caps.reports ? getTrends(filters, caps) : Promise.resolve(null),
    caps.reports ? getLeaderboards(filters, caps) : Promise.resolve(null),
  ]);

  const tabs: CardTab[] = [];
  const o = board.orders;
  if (o && o !== "error") {
    const late = o.ageing.reduce((n, a) => n + a.value, 0);
    const lateOrders = o.ageing.reduce((n, a) => n + a.orders, 0);
    tabs.push({
      key: "book",
      label: "Book",
      title: "When does the order book ship?",
      subtitle: o.currency ? `Open order value by delivery month · ${o.currency}` : "Open orders by delivery month",
      aside: <DueLegend />,
      body: (
        <DueByMonth
          bare
          months={o.byMonth}
          currency={o.currency}
          thisMonth={today().slice(0, 7)}
          summary={
            <BookSummary
              note={`${o.open} open orders · ${fmtCompactNumber(o.qty)} pcs`}
              rows={[
                { label: "In production", value: `${o.inProduction} orders`, n: o.inProduction, tone: "primary" },
                { label: "Not started", value: `${o.open - o.inProduction} orders`, n: o.open - o.inProduction, tone: "info" },
                { label: "Late", value: o.currency ? fmtMoneyShort(late, o.currency) : `${lateOrders} orders`, n: lateOrders, tone: "danger" },
              ]}
            />
          }
        />
      ),
      footer: (
        <CardFooter
          facts={[
            { label: "Open", value: o.value != null ? fmtMoneyShort(o.value, o.currency) : `${o.open} orders`, tone: "primary" },
            { label: "Late", value: o.currency ? fmtMoneyShort(late, o.currency) : `${lateOrders} orders`, tone: "danger" },
          ]}
          href="/orders/all"
          cta="Open orders"
        />
      ),
    });
  }

  if (trends) {
    const byKey = new Map(trendTabs(trends).map((t) => [t.key, t]));
    const revenue = byKey.get("revenue");
    if (revenue) tabs.push({ ...revenue, title: "How much did we invoice, and collect?", footer: <CardFooter href="/finance/receivables" cta="Receivables" /> });
    const output = byKey.get("production");
    if (output) tabs.push({ ...output, label: "Output", title: "How many good pieces, how many rejects?", footer: <CardFooter href="/production" cta="Production" /> });
  }

  const buyers = boards?.find((b) => b.key === "customers");
  if (buyers && (buyers.rows.ok ? buyers.rows.value.length > 0 : buyers.rows.reason !== "denied")) {
    tabs.push({
      key: "buyers",
      label: "Top buyers",
      title: "Who are our biggest buyers?",
      subtitle: `${buyers.note} · ${periodWords(filters)}`,
      // The one tab the period changes, so it carries the switch (plan option A).
      aside: <PeriodSwitch filters={filters} carry={carry} />,
      body: <LeaderboardList rows={buyers.rows} />,
      footer: <CardFooter href="/reports" cta="Reports" />,
    });
  }

  if (tabs.length === 0) return null;
  return <TabbedCard tabs={tabs} label="Order book" icon="chart-column" tone="primary" className="h-full" />;
}
