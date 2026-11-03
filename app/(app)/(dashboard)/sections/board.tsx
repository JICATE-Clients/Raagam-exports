import type { ReactNode } from "react";
import { getBoard, type Board } from "@/lib/dashboard/board";
import { monthLabel, today } from "@/lib/dashboard/range";
import type { DashboardCaps, DashboardTone } from "@/lib/dashboard/types";
import { fmtDate } from "@/lib/format";
import { fmtCompactInr, fmtCompactNumber } from "@/lib/dashboard/format";
import {
  BuyingBars,
  DueByMonth,
  InsightInline,
  InsightStrip,
  LateAgeing,
  BookSummary,
  fmtMoneyShort,
  type Insight,
} from "@/components/dashboard/board";
import { BlockGrid, KpiCard, KpiCardError, MiniColumns, SplitBar } from "@/components/dashboard/kpi";
import { cn } from "@/lib/utils";

const LATE_HREF = "/orders/progress";
const ORDERS_HREF = "/orders/all";
const PO_HREF = "/purchase/orders";
const AR_HREF = "/finance/receivables";

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

const AGE_TONE: DashboardTone[] = ["warning", "warning", "danger", "danger"];

/**
 * THE KPI ROW (approved plan v2, 2026-11-02) — five cards, each a figure with the small
 * chart that explains it. Purchase orders left the row: its counts are now the subtitle of
 * "What are we buying?", where they have context. A card the viewer may not see is left
 * out (`null`); a failed read is said, never zeroed.
 */
export async function BoardKpis({ caps }: { caps: DashboardCaps }) {
  const b = await getBoard(caps);
  const tiles: ReactNode[] = [];
  const o = b.orders;

  if (o === "error") tiles.push(<KpiCardError key="orders" label="Orders" />);
  else if (o) {
    const by = new Date(Date.parse(today()) + 30 * 86_400_000).toISOString().slice(0, 10);
    tiles.push(
      <KpiCard key="book" label="Order book" href={ORDERS_HREF}
        pill={`${o.open} open`}
        value={o.value != null ? fmtMoneyShort(o.value, o.currency) : `${fmtCompactNumber(o.open)} orders`}
        sub={`${fmtCompactNumber(o.qty)} pcs · ${Math.round(pct(o.inProduction, o.open))}% in production`}>
        <SplitBar title="In production · not started"
          parts={[{ value: o.inProduction, tone: "primary" }, { value: o.open - o.inProduction, tone: "info" }]} />
      </KpiCard>,
      <KpiCard key="late" label="Late orders" href={LATE_HREF}
        pill={`${Math.round(pct(o.late, o.dated))}%`} pillTone={o.late > 0 ? "danger" : "success"}
        value={fmtCompactNumber(o.late)} valueTone={o.late > 0 ? "danger" : undefined}
        sub={`of ${o.dated} dated, past delivery`}>
        <MiniColumns bars={o.ageing.map((a, i) => ({ value: a.orders, tone: AGE_TONE[i], label: `${a.label} days` }))} />
      </KpiCard>,
      <KpiCard key="due" label="Due in 30 days" href={LATE_HREF}
        pill={`${Math.round(pct(o.due30, o.dated))}%`} pillTone="warning"
        value={fmtCompactNumber(o.due30)} sub={`orders to ship by ${fmtDate(by)}`}>
        <SplitBar title="Due in 30 days · later" parts={[{ value: o.due30, tone: "warning" }, { value: o.dated - o.due30, tone: "track" }]} />
      </KpiCard>,
    );
  }

  const m = b.milestones;
  if (m === "error") tiles.push(<KpiCardError key="ms" label="Milestones" />);
  else if (m && m.total > 0)
    tiles.push(
      <KpiCard key="ms" label="Milestones" href={LATE_HREF}
        pill={`${Math.round(pct(m.done, m.total))}%`} pillTone="success"
        value={`${m.done} / ${m.total}`} sub="T&A steps done">
        <BlockGrid done={m.done} total={m.total} tone="success" />
      </KpiCard>,
    );

  const r = b.receivables;
  if (r === "error") tiles.push(<KpiCardError key="ar" label="Receivables" />);
  else if (r && r.open > 0)
    tiles.push(
      <KpiCard key="ar" label="Receivables" href={AR_HREF}
        pill={`${Math.round(pct(r.collected, r.open))}% in`} pillTone="accent"
        value={fmtCompactInr(r.open)} sub={`${fmtCompactInr(r.collected)} collected`}>
        <SplitBar title="Collected · open" parts={[{ value: r.collected, tone: "accent" }, { value: r.open - r.collected, tone: "track" }]} />
      </KpiCard>,
    );

  if (tiles.length === 0) return null;
  return <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", KPI_COLS[tiles.length])}>{tiles}</div>;
}

/** Wide-screen columns by card count, so a short row still fills the width. */
const KPI_COLS: Record<number, string> = {
  1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5",
};

/** "When is work due?" with the book's split beside it — the page's main chart. */
export async function BoardDue({ caps }: { caps: DashboardCaps }) {
  const o = (await getBoard(caps)).orders;
  if (!o || o === "error") return null;
  const late = o.ageing.reduce((n, a) => n + a.value, 0);
  const lateOrders = o.ageing.reduce((n, a) => n + a.orders, 0);
  return (
    <DueByMonth
      months={o.byMonth}
      currency={o.currency}
      thisMonth={today().slice(0, 7)}
      summary={
        <BookSummary
          total={o.value != null ? fmtMoneyShort(o.value, o.currency) : `${o.open} orders`}
          note={`${o.open} open orders · ${fmtCompactNumber(o.qty)} pcs`}
          rows={[
            { label: "In production", value: `${o.inProduction} orders`, n: o.inProduction, tone: "primary" },
            { label: "Not started", value: `${o.open - o.inProduction} orders`, n: o.open - o.inProduction, tone: "info" },
            { label: "Late", value: o.currency ? fmtMoneyShort(late, o.currency) : `${lateOrders} orders`, n: lateOrders, tone: "danger" },
          ]}
        />
      }
    />
  );
}

export async function BoardAgeing({ caps }: { caps: DashboardCaps }) {
  const o = (await getBoard(caps)).orders;
  if (!o || o === "error") return null;
  return <LateAgeing buckets={o.ageing} currency={o.currency} href={LATE_HREF} />;
}

export async function BoardBuying({ caps }: { caps: DashboardCaps }) {
  const p = (await getBoard(caps)).purchase;
  if (!p || p === "error" || p.byClass.length === 0) return null;
  return (
    <BuyingBars rows={p.byClass} href={PO_HREF} subtitle={`${p.total} POs · ${p.approved} approved · ${p.pending} pending`} />
  );
}

/** Up to five facts read off the same figures — never a number the rings and charts don't already hold. */
function insights(b: Board): Insight[] {
  const out: Insight[] = [];
  const o = b.orders !== "error" ? b.orders : null;
  if (o) {
    const thisMonth = today().slice(0, 7);
    const money = (v: number, n: number) => (o.currency ? `${fmtMoneyShort(v, o.currency)} · ${n} orders` : `${n} orders`);
    const biggest = [...o.byMonth].sort((a, z) => (o.currency ? z.value - a.value : z.orders - a.orders))[0];
    if (biggest)
      out.push({
        label: "Biggest month",
        value: monthLabel(`${biggest.month}-01`),
        sub: money(biggest.value, biggest.orders),
        tone: biggest.month < thisMonth ? "danger" : "primary",
        href: ORDERS_HREF,
      });
    out.push({ label: "Coming up", value: `${o.due30} orders`, sub: "due in 30 days", tone: "warning", href: LATE_HREF });
    const oldest = o.ageing[o.ageing.length - 1];
    if (oldest.orders > 0)
      out.push({ label: "Oldest late", value: `${oldest.orders} orders`, sub: `${oldest.label} days`, tone: "danger", href: LATE_HREF });
    const next = o.byMonth.filter((x) => x.month > thisMonth).sort((a, z) => (o.currency ? z.value - a.value : z.orders - a.orders))[0];
    if (next)
      out.push({ label: "Next big month", value: monthLabel(`${next.month}-01`), sub: money(next.value, next.orders), tone: "success", href: ORDERS_HREF });
  }
  const r = b.receivables !== "error" ? b.receivables : null;
  if (r && r.open > 0)
    out.push({ label: "Collected", value: fmtCompactInr(r.collected), sub: `of ${fmtCompactInr(r.open)} open`, tone: "muted", href: AR_HREF });
  return out.slice(0, 5);
}

export async function BoardStrip({ caps }: { caps: DashboardCaps }) {
  return <InsightStrip items={insights(await getBoard(caps))} />;
}

/** The facts as one line in the period bar (2026-11-02) — what the page renders now. */
export async function BoardStripInline({ caps }: { caps: DashboardCaps }) {
  return <InsightInline items={insights(await getBoard(caps))} />;
}
