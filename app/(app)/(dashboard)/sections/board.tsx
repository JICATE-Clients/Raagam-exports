import type { ReactNode } from "react";
import { getBoard, type Board } from "@/lib/dashboard/board";
import { monthLabel, today } from "@/lib/dashboard/range";
import type { DashboardCaps } from "@/lib/dashboard/types";
import { fmtCompactInr, fmtCompactNumber } from "@/lib/dashboard/format";
import {
  BuyingBars,
  DueByMonth,
  InsightStrip,
  LateAgeing,
  RingTile,
  RingTileError,
  fmtMoneyShort,
  type Insight,
} from "@/components/dashboard/board";
import { cn } from "@/lib/utils";

const LATE_HREF = "/orders/progress";
const ORDERS_HREF = "/orders/all";
const PO_HREF = "/purchase/orders";
const AR_HREF = "/finance/receivables";

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** Wide-screen columns by tile count, so a short row fills the width (same rule as the old headline). */
const RING_COLS: Record<number, string> = {
  1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3",
  4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6",
};

/**
 * The ring row — six real shares, each left out when the viewer may not see
 * its module (`null`), and said rather than zeroed when its read failed.
 */
export async function BoardRings({ caps }: { caps: DashboardCaps }) {
  const b = await getBoard(caps);
  const tiles: ReactNode[] = [];
  const o = b.orders;

  if (o === "error") tiles.push(<RingTileError key="orders" label="Orders" />);
  else if (o) {
    tiles.push(
      <RingTile key="late" label="Late orders" value={fmtCompactNumber(o.late)} sub={`of ${o.dated} open`}
        pct={pct(o.late, o.dated)} tone={o.late > 0 ? "danger" : "success"} href={LATE_HREF} />,
      <RingTile key="book" label="Order book" value={o.value != null ? fmtMoneyShort(o.value, o.currency) : fmtCompactNumber(o.open)}
        sub={`${fmtCompactNumber(o.qty)} pcs · in production`} pct={pct(o.inProduction, o.open)} tone="primary" href={ORDERS_HREF} />,
      <RingTile key="due" label="Due in 30 days" value={fmtCompactNumber(o.due30)} sub="orders"
        pct={pct(o.due30, o.dated)} center={String(o.due30)} tone="warning" href={LATE_HREF} />,
    );
  }

  const m = b.milestones;
  if (m === "error") tiles.push(<RingTileError key="ms" label="Milestones" />);
  else if (m && m.total > 0)
    tiles.push(<RingTile key="ms" label="Milestones" value={`${m.done}/${m.total}`} sub="done" pct={pct(m.done, m.total)} tone="success" href={LATE_HREF} />);

  const p = b.purchase;
  if (p === "error") tiles.push(<RingTileError key="po" label="Purchase orders" />);
  else if (p && p.total > 0)
    tiles.push(
      <RingTile key="po" label="Purchase orders" value={String(p.total)} sub={`${p.approved} approved · ${p.pending} pending`}
        pct={pct(p.approved, p.total)} tone="info" href={PO_HREF} />,
    );

  const r = b.receivables;
  if (r === "error") tiles.push(<RingTileError key="ar" label="Receivables" />);
  else if (r && r.open > 0)
    tiles.push(<RingTile key="ar" label="Receivables" value={fmtCompactInr(r.open)} sub="collected" pct={pct(r.collected, r.open)} tone="success" href={AR_HREF} />);

  if (tiles.length === 0) return null;
  return <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", RING_COLS[tiles.length])}>{tiles}</div>;
}

/** The order charts and the buying bars, in one row. */
export async function BoardCharts({ caps }: { caps: DashboardCaps }) {
  const b = await getBoard(caps);
  const o = b.orders !== "error" ? b.orders : null;
  const p = b.purchase !== "error" ? b.purchase : null;
  const thisMonth = today().slice(0, 7);
  const cards = [
    o && <DueByMonth key="due" months={o.byMonth} currency={o.currency} thisMonth={thisMonth} />,
    o && <LateAgeing key="late" buckets={o.ageing} currency={o.currency} href={LATE_HREF} />,
    p && p.byClass.length > 0 && <BuyingBars key="buy" rows={p.byClass} href={PO_HREF} />,
  ].filter(Boolean);
  if (cards.length === 0) return null;
  return (
    <div className={cn("grid grid-cols-1 gap-4", cards.length === 3 ? "lg:grid-cols-[1.3fr_1fr_1fr]" : cards.length === 2 ? "lg:grid-cols-2" : "")}>
      {cards}
    </div>
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
