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
import { toneText, toneVar } from "./tone";

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
}: {
  months: { month: string; orders: number; value: number }[];
  currency: string | null;
  thisMonth: string;
  /** The book's split, drawn left of the columns (plan v2: the page's main chart). */
  summary?: ReactNode;
}) {
  // A mixed-currency book cannot be summed, so the columns count orders instead.
  const byValue = currency !== null;
  const metric = (m: { orders: number; value: number }) => (byValue ? m.value : m.orders);
  const max = Math.max(1, ...months.map(metric));
  return (
    <ChartFrame
      title="When is work due?"
      subtitle={byValue ? "Open order value by delivery month" : "Open orders by delivery month"}
      icon="chart-column"
      aside={<Legend items={[["danger", "Past"], ["warning", "This month"], ["primary", "Ahead"]]} />}
    >
      <div className={cn(summary && "grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]")}>
      {summary}
      {months.length === 0 ? (
        <ChartEmpty>No open orders carry a delivery date.</ChartEmpty>
      ) : (
        <div className="min-w-0">
          <div className="flex h-48 items-end gap-2 border-b border-border pt-5">
            {months.map((m) => {
              const tone: DashboardTone = m.month < thisMonth ? "danger" : m.month === thisMonth ? "warning" : "primary";
              const v = metric(m);
              return (
                <div key={m.month} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10.5px] font-bold tabular-nums text-heading">
                    {byValue ? fmtMoneyShort(v, currency) : v}
                  </span>
                  <span
                    className="block w-full max-w-12 rounded-t-[6px]"
                    style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: toneVar(tone) }}
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
      </div>
    </ChartFrame>
  );
}

/** Left of the main chart: the book's total, then each part with a share bar. */
export function BookSummary({
  total,
  note,
  rows,
}: {
  total: string;
  note: string;
  rows: { label: string; value: string; n: number; tone: DashboardTone }[];
}) {
  const whole = Math.max(1, rows.slice(0, 2).reduce((a, r) => a + r.n, 0));
  return (
    <div className="min-w-0">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Total open</span>
      <p className="mt-1 text-[32px] font-extrabold leading-none tracking-tight tabular-nums text-heading">{total}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      <ul className="mt-4 grid gap-2.5">
        {rows.map((r) => (
          <li key={r.label} className="grid gap-1 text-xs">
            <span className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-[2px]" style={{ background: toneVar(r.tone) }} />
                {r.label}
              </span>
              <b className="tabular-nums">{r.value}</b>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--glass-track)]">
              <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (r.n / whole) * 100)}%`, background: toneVar(r.tone) }} />
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
  return (
    <ChartFrame
      title="How late?"
      subtitle="Late orders by days past delivery"
      icon="hourglass"
      tone="danger"
      aside={<Link href={href} className="text-xs font-semibold text-primary hover:underline">{late} late</Link>}
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
                    className="block h-full rounded-[5px] pl-1.5 text-[10px] font-bold leading-4 text-white"
                    style={{ width: `${Math.max(8, (b.orders / max) * 100)}%`, background: toneVar(AGE_TONE[i]) }}
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
      aside={<Link href={href} className="text-xs font-semibold text-primary hover:underline">POs</Link>}
    >
      {rows.length === 0 ? (
        <ChartEmpty>No purchase orders yet.</ChartEmpty>
      ) : (
        <div className="grid gap-3">
          {rows.slice(0, 6).map((r) => (
            <div key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr_4.5rem] items-center gap-2.5 text-xs">
              <Truncated text={r.label} className="block text-muted-foreground" />
              <span className="h-4 overflow-hidden rounded-[5px] bg-[var(--glass-track)]">
                <span className="block h-full rounded-[5px]" style={{ width: `${Math.max(2, (r.amount / max) * 100)}%`, background: toneVar("info") }} />
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
          <span className="size-2 rounded-full" style={{ background: toneVar(tone) }} />
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
