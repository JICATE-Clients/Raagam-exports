import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
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

type Vars = CSSProperties & Record<`--${string}`, string | number>;

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

/** The headline tile: a ring that is a real share of a real whole, the figure, one short line. */
export function RingTile({
  label,
  value,
  sub,
  pct,
  center,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  /** 0–100; the ring's fill. */
  pct: number;
  /** What sits inside the ring — the share by default. */
  center?: string;
  tone: DashboardTone;
  href?: string;
}) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const body = (
    <>
      <span
        aria-hidden
        className="grid size-[58px] shrink-0 place-items-center rounded-full bg-[conic-gradient(var(--tone)_0_calc(var(--pct)*1%),var(--glass-track)_calc(var(--pct)*1%)_100%)]"
        style={{ "--pct": p, "--tone": toneVar(tone) } as Vars}
      >
        <span className="grid size-[44px] place-items-center rounded-full bg-surface text-[11px] font-bold tabular-nums">
          {center ?? `${p}%`}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{label}</span>
        <span className="block text-xl font-bold leading-tight tabular-nums text-heading">{value}</span>
        {sub && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </>
  );
  const cls = cn(GLASS, "flex min-w-0 items-center gap-3 border p-3.5");
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <Card className={cls}>{body}</Card>
  );
}

/** A tile whose read failed — said, never drawn as 0. */
export function RingTileError({ label }: { label: string }) {
  return (
    <Card className={cn(GLASS, "flex min-w-0 items-center gap-3 p-3.5")}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{label}</span>
      <span className="ml-auto text-xs text-danger">Couldn&apos;t load</span>
    </Card>
  );
}

/** "When is work due?" — open order value per delivery month; past months red, this month amber. */
export function DueByMonth({
  months,
  currency,
  thisMonth,
}: {
  months: { month: string; orders: number; value: number }[];
  currency: string | null;
  thisMonth: string;
}) {
  // A mixed-currency book cannot be summed, so the columns count orders instead.
  const byValue = currency !== null;
  const metric = (m: { orders: number; value: number }) => (byValue ? m.value : m.orders);
  const max = Math.max(1, ...months.map(metric));
  return (
    <ChartFrame title="When is work due?" aside={<Legend items={[["danger", "Past"], ["warning", "This month"], ["primary", "Ahead"]]} />}>
      {months.length === 0 ? (
        <ChartEmpty>No open orders carry a delivery date.</ChartEmpty>
      ) : (
        <div>
          <div className="flex h-40 items-end gap-1.5 border-b border-border pt-5">
            {months.map((m) => {
              const tone: DashboardTone = m.month < thisMonth ? "danger" : m.month === thisMonth ? "warning" : "primary";
              const v = metric(m);
              return (
                <div key={m.month} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {byValue ? fmtMoneyShort(v, currency) : v}
                  </span>
                  <span
                    className="block w-full max-w-8 rounded-t-[5px]"
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
    </ChartFrame>
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
export function BuyingBars({ rows, href }: { rows: { label: string; amount: number }[]; href: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <ChartFrame
      title="What are we buying?"
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
