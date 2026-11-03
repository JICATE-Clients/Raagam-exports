import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";
import { fmtCompactInr } from "@/lib/dashboard/format";
import { monthLabel } from "@/lib/dashboard/range";
import type { DashboardTone } from "@/lib/dashboard/types";
import { ChartEmpty, ChartFrame } from "./charts";
import { GLASS } from "./glass";
import { CardFooter } from "./card-footer";
import { toneGrad, toneText } from "./tone";

/**
 * The redesigned dashboard's visuals (approved plan 2026-10-30): ring tiles,
 * column and bar charts, and the insight strip. Short labels by rule — a card's
 * title is the question it answers and nothing under it explains itself in a
 * sentence (user: "reduce wording, more visual clarity").
 */

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/** $2.05M / $413K / ₹25.40 L — the currency's own short form. */
export function fmtMoneyShort(value: number, currency: string | null): string {
  if (!currency || currency === "INR") return fmtCompactInr(value);
  const sym = SYMBOL[currency] ?? `${currency} `;
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${sym}${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sym}${Math.round(value / 1e3).toLocaleString("en-IN")}K`;
  return `${sym}${Math.round(value)}`;
}

/** "When is work due?" — open order value per delivery month; past months red, this month amber. */
export function DueByMonth({
  months,
  currency,
  thisMonth,
  summary,
  bare = false,
}: {
  months: { month: string; orders: number; value: number }[];
  currency: string | null;
  thisMonth: string;
  /** The book's split, drawn left of the columns (plan v2: the page's main chart). */
  summary?: ReactNode;
  /** Body only, no frame — the order book card draws its own header and tabs (2026-11-03). */
  bare?: boolean;
}) {
  // A mixed-currency book cannot be summed, so the columns count orders instead.
  const byValue = currency !== null;
  const metric = (m: { orders: number; value: number }) => (byValue ? m.value : m.orders);
  const max = Math.max(1, ...months.map(metric));
  // The biggest month glows and says "Peak" (the insight strip's "Biggest month", folded into
  // the chart it described). The first month not yet past gets the dashed "today" line.
  const peak = months.reduce((best, m, i) => (metric(m) > metric(months[best] ?? m) ? i : best), 0);
  const firstAhead = months.findIndex((m) => m.month >= thisMonth);
  const frame = (body: ReactNode) =>
    bare ? (
      body
    ) : (
      <ChartFrame
        title="When is work due?"
        subtitle={byValue ? "Open order value by delivery month" : "Open orders by delivery month"}
        icon="chart-column"
        aside={<DueLegend />}
      >
        {body}
      </ChartFrame>
    );
  return frame(
      // BARE = inside the order book card's fixed-height cell (2026-11-03, screenshot 4012
      // "looks cropped"): the columns take whatever height the cell has, not a fixed h-48.
      <div className={cn(summary && "grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]", bare && "h-full min-h-0")}>
      {summary}
      {months.length === 0 ? (
        <ChartEmpty>No open orders carry a delivery date.</ChartEmpty>
      ) : (
        <div className={cn("min-w-0", bare && "flex h-full min-h-0 flex-col")}>
          {/* HOVER FOCUS: the bar under the pointer stays bright, the rest dim to 40%. */}
          <div className={cn("group/bars flex items-end gap-2 border-b border-border pt-5", bare ? "min-h-0 flex-1" : "h-48")}>
            {/* FOCUS = HOVER (fix 5): Tab lands on a month and it gets the same bright bar and
                value bubble the mouse gets, so the figures are not mouse-only. */}
            {months.map((m, i) => {
              const tone: DashboardTone = m.month < thisMonth ? "danger" : m.month === thisMonth ? "warning" : "primary";
              const v = metric(m);
              return (
                <div
                  key={m.month}
                  tabIndex={0}
                  aria-label={`${monthLabel(`${m.month}-01`)}: ${byValue ? fmtMoneyShort(v, currency) : `${v} orders`}, ${m.orders} orders${i === peak ? ", the peak month" : ""}`}
                  className={cn(
                    "group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-t-md transition-opacity duration-200 focus-visible:outline-none group-hover/bars:opacity-40 group-focus-within/bars:opacity-40 hover:opacity-100! focus-visible:opacity-100!",
                    // The dashed "today" line: past months to its left, the coming ones to its right.
                    i === firstAhead && firstAhead > 0 && "before:absolute before:-left-1 before:top-0 before:bottom-0 before:border-l before:border-dashed before:border-heading/50",
                  )}
                >
                  {i === firstAhead && firstAhead > 0 && (
                    <span className="absolute -left-1 top-[-14px] -translate-x-1/2 text-[9px] font-semibold uppercase tracking-wide text-heading">today</span>
                  )}
                  {/* The value bubble on hover: the month in full and its order count. */}
                  <span className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-heading px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {monthLabel(`${m.month}-01`)} · {m.orders} orders
                  </span>
                  <span className="text-[10.5px] font-bold tabular-nums text-heading">
                    {i === peak && <span className="mr-0.5 text-[9px] font-bold uppercase text-primary">Peak</span>}
                    {byValue ? fmtMoneyShort(v, currency) : v}
                  </span>
                  <span
                    // Rises month by month, so time reads left to right (dash-rise, globals.css).
                    className={cn(
                      "dash-rise block w-full max-w-12 rounded-t-[6px] transition-[filter] hover:brightness-110 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary",
                      i === peak && "shadow-[0_0_18px_-3px_var(--primary)]",
                    )}
                    style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: toneGrad(tone), animationDelay: `${i * 70}ms` }}
                    title={`${monthLabel(`${m.month}-01`)} · ${m.orders} orders`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-1.5">
            {months.map((m) => (
              <span key={m.month} className="min-w-0 flex-1 text-center text-[10px] text-muted-foreground">
                {monthLabel(`${m.month}-01`)}
              </span>
            ))}
          </div>
        </div>
      )}
      </div>,
  );
}

/** The due chart's key: past red, this month amber, ahead blue. Exported for the order book card. */
export function DueLegend() {
  return <Legend items={[["danger", "Past"], ["warning", "This month"], ["primary", "Ahead"]]} />;
}

/** Left of the main chart: the book's total, then each part with a share bar. */
export function BookSummary({
  total,
  note,
  rows,
}: {
  /** The book's total. Left out inside the order book card, where the KPI tile above already
   *  says it (fix 4, 2026-11-03) — the chart takes the width instead. */
  total?: string;
  note: string;
  rows: { label: string; value: string; n: number; tone: DashboardTone }[];
}) {
  const whole = Math.max(1, rows.slice(0, 2).reduce((a, r) => a + r.n, 0));
  return (
    <div className="min-w-0">
      {/* No "Total open" eyebrow: the card's question already names it (one-screen fit, 2026-11-03). */}
      <p className="sr-only">Total open</p>
      {total && <p className="text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-heading">{total}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      <ul className="mt-2.5 grid gap-1.5">
        {rows.map((r) => (
          <li key={r.label} className="grid gap-1 text-xs">
            <span className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-[2px]" style={{ background: toneGrad(r.tone) }} />
                {r.label}
              </span>
              <b className="tabular-nums">{r.value}</b>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--glass-track)]">
              <span className="dash-grow block h-full rounded-full" style={{ width: `${Math.min(100, (r.n / whole) * 100)}%`, background: toneGrad(r.tone, 90) }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const AGE_TONE: DashboardTone[] = ["warning", "warning", "danger", "danger"];

/** "How late?" — late open orders by days past delivery. */
export function LateAgeing({
  buckets,
  currency,
  href,
}: {
  buckets: { label: string; orders: number; value: number }[];
  currency: string | null;
  href: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.orders));
  const late = buckets.reduce((n, b) => n + b.orders, 0);
  const lateValue = buckets.reduce((n, b) => n + b.value, 0);
  // GOOD NEWS TAKES LESS ROOM (fix 1, 2026-11-03): with nothing late the card is a tick and
  // a sentence, and `data-all-clear` lets the page narrow its cell so Buying gets the width.
  // The moment an order is late it is the full ageing picture again.
  if (late === 0) {
    return (
      <Card data-all-clear="" className={cn(GLASS, "flex min-w-0 flex-col items-center justify-center gap-2 px-3 py-4 text-center")}>
        <span className="grid size-10 place-items-center rounded-full text-lg font-bold text-white shadow-[0_8px_18px_-10px_var(--success)]" style={{ background: toneGrad("success") }} aria-hidden>
          ✓
        </span>
        <p className="text-sm font-semibold text-success">Nothing late</p>
        <p className="text-[11px] text-muted-foreground">No open order is past its delivery date</p>
      </Card>
    );
  }
  return (
    <ChartFrame
      title="How late?"
      subtitle="Late orders by days past delivery"
      icon="hourglass"
      tone="danger"
      footer={
        <CardFooter
          facts={[{ label: "Late", value: `${late} orders`, tone: "danger" }, ...(currency ? [{ label: "Worth", value: fmtMoneyShort(lateValue, currency) }] : [])]}
          href={href}
          cta="Order progress"
        />
      }
    >
      {late === 0 ? (
        <ChartEmpty>No open order is past its delivery date.</ChartEmpty>
      ) : (
        <div className="grid gap-3">
          {buckets.map((b, i) => (
            <div key={b.label} className="grid grid-cols-[3.25rem_1fr_4.5rem] items-center gap-2.5 text-xs">
              <span className="text-muted-foreground">{b.label} d</span>
              <span className="h-4 overflow-hidden rounded-[5px] bg-[var(--glass-track)]">
                {b.orders > 0 && (
                  <span
                    className="dash-grow block h-full rounded-[5px] pl-1.5 text-[10px] font-bold leading-4 text-white"
                    style={{ width: `${Math.max(8, (b.orders / max) * 100)}%`, background: toneGrad(AGE_TONE[i], 90), animationDelay: `${i * 90}ms` }}
                  >
                    {b.orders}
                  </span>
                )}
              </span>
              <span className="text-right font-semibold tabular-nums">
                {currency ? fmtMoneyShort(b.value, currency) : b.orders}
              </span>
            </div>
          ))}
        </div>
      )}
    </ChartFrame>
  );
}

/** "What are we buying?" — PO value by item class. */
export function BuyingBars({ rows, href, subtitle }: { rows: { label: string; amount: number }[]; href: string; subtitle?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <ChartFrame
      title="What are we buying?"
      subtitle={subtitle}
      icon="shopping-cart"
      tone="info"
      footer={
        <CardFooter
          facts={[{ label: "Total", value: fmtCompactInr(rows.reduce((n, r) => n + r.amount, 0)), tone: "info" }]}
          href={href}
          cta="Purchase orders"
        />
      }
    >
      {rows.length === 0 ? (
        <ChartEmpty>No purchase orders yet.</ChartEmpty>
      ) : (
        <div className="grid gap-3">
          {rows.slice(0, 6).map((r, i) => (
            <div key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr_4.5rem] items-center gap-2.5 text-xs">
              <Truncated text={r.label} className="block text-muted-foreground" />
              <span className="h-4 overflow-hidden rounded-[5px] bg-[var(--glass-track)]">
                <span className="dash-grow block h-full rounded-[5px]" style={{ width: `${Math.max(2, (r.amount / max) * 100)}%`, background: toneGrad("info", 90), animationDelay: `${i * 90}ms` }} />
              </span>
              <span className="text-right font-semibold tabular-nums">{fmtCompactInr(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </ChartFrame>
  );
}

function Legend({ items }: { items: [DashboardTone, string][] }) {
  return (
    <span className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
      {items.map(([tone, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: toneGrad(tone) }} />
          {label}
        </span>
      ))}
    </span>
  );
}

export interface Insight {
  label: string;
  value: string;
  sub: string;
  tone: DashboardTone;
  href?: string;
}

/** The bottom strip: up to five facts worth a glance, each one a link to its list. */
/**
 * THE SAME FACTS, ONE LINE, IN THE PERIOD BAR (user 2026-11-02, screenshots 144758 / 144841:
 * "move this into the top … compact it"). It used to be a card band of its own under the
 * activity lists; now it rides the right of Today · Week · Month · Custom. Label above, bold
 * value and its coloured note beside each other, parted by hairlines; wraps on a narrow pane.
 * One or two facts are fine here — the band's "fewer than three is not worth a row" rule was
 * about a stretched lone tile, which a line in a bar is not.
 */
export function InsightInline({ items }: { items: Insight[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-y-1.5">
      {items.map((it, i) => {
        const inner: ReactNode = (
          <>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{it.label}</span>
            <span className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-[13px] font-bold tabular-nums text-heading">{it.value}</span>
              <span className={cn("text-[11px] font-medium", toneText[it.tone])}>{it.sub}</span>
            </span>
          </>
        );
        const cls = cn("min-w-0 px-3 leading-tight", i > 0 && "border-l border-border");
        return it.href ? (
          <Link key={it.label} href={it.href} className={cn(cls, "rounded-control hover:bg-[var(--glass-row)]")}>{inner}</Link>
        ) : (
          <div key={it.label} className={cls}>{inner}</div>
        );
      })}
    </div>
  );
}

export function InsightStrip({ items }: { items: Insight[] }) {
  // Fewer than three facts is a lone tile stretched across the page
  // (screenshot 3859: one "Coming up 0 orders" card) — not worth a row.
  if (items.length < 3) return null;
  return (
    <Card className={cn(GLASS, "grid grid-cols-2 gap-y-3 p-3.5 md:grid-cols-3 xl:grid-cols-5")}>
      {items.map((it, i) => {
        const inner: ReactNode = (
          <>
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{it.label}</span>
            <span className="block text-lg font-bold leading-tight tabular-nums text-heading">{it.value}</span>
            <span className={cn("block text-[11px] font-medium", toneText[it.tone])}>{it.sub}</span>
          </>
        );
        const cls = cn("min-w-0 px-3", i > 0 && "xl:border-l xl:border-border");
        return it.href ? (
          <Link key={it.label} href={it.href} className={cn(cls, "rounded-control hover:bg-[var(--glass-row)]")}>{inner}</Link>
        ) : (
          <div key={it.label} className={cls}>{inner}</div>
        );
      })}
    </Card>
  );
}
