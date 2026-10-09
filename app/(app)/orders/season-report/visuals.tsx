"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Package, Shirt, Truck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber } from "@/lib/format";
import { Truncated } from "@/components/ui/truncated";
import {
  byCustomer,
  byDeliveryMonth,
  daysUntil,
  nextDelivery,
  ringSegments,
  totalsOf,
  type Totals,
} from "@/lib/orders/season-report/derive";
import { FULFILMENT_LABEL, FULFILMENT_ORDER, type Fulfilment, type SeasonOrder } from "@/lib/orders/season-report/types";
import { shortQty } from "@/lib/orders/progress/view";

/**
 * Orders ▸ Season Report ▸ Overview — the season at a glance, in the same
 * approved glass look Order Progress uses (budget-breakdown-chart.tsx is the
 * reference), because an order person moving between the two should not feel a
 * seam.
 *
 * Five questions, one card each:
 *
 *   1. How much is committed, and how much has gone?   → hero + stacked bar
 *   2. Where do the pieces stand?                      → ring
 *   3. When are they due?                              → deliveries by month
 *   4. Whose are they?                                 → buyers ranked
 *   5. What needs chasing?                             → late / at-risk list
 *
 * …and under them every order as a card with its picture, because a buyer is
 * remembered by the garment, not by the RE number.
 *
 * Colour means state, here: one colour per fulfilment state, the same in the
 * ring, the bars, the chips and the card edges, so the eye learns it once.
 * Motion is a single settle-in, and none at all under reduced motion.
 */

export const FULFILMENT_COLOR: Record<Fulfilment, string> = {
  shipped: "var(--success)",
  partial: "var(--info)",
  in_production: "var(--primary)",
  /* A softened slate: pending is the QUIET state, and at full strength it made a
     season with nothing shipped yet read as a wall of black. */
  pending: "color-mix(in oklab, var(--muted-foreground) 55%, white)",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5)} ’${ym.slice(2, 4)}` : "No date");

/** "in 12 days", "due today", "3 days late" — and whether it is a problem. */
export function dueText(o: Pick<SeasonOrder, "deliveryDate" | "fulfilment">, today: string): { text: string; bad: boolean } {
  if (o.fulfilment === "shipped") return { text: "Delivered", bad: false };
  if (!o.deliveryDate) return { text: "No delivery date", bad: false };
  const d = daysUntil(o.deliveryDate, today);
  if (d < 0) return { text: `${-d} day${d === -1 ? "" : "s"} late`, bad: true };
  if (d === 0) return { text: "Due today", bad: true };
  return { text: `in ${d} day${d === 1 ? "" : "s"}`, bad: false };
}

const ANIMATION_CSS = `
@media (prefers-reduced-motion: no-preference) {
  .sr-rise { animation: sr-rise 520ms cubic-bezier(.2,.8,.2,1) both; }
  .sr-grow { transform-origin: bottom; animation: sr-grow 720ms cubic-bezier(.2,.8,.2,1) both; }
  .sr-sweep { animation: sr-sweep 900ms cubic-bezier(.2,.8,.2,1) both; }
  .sr-ring { animation: sr-ring 1100ms cubic-bezier(.2,.8,.2,1) both; }
}
@keyframes sr-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes sr-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes sr-sweep { from { transform: scaleX(0); transform-origin: left; } to { transform: scaleX(1); transform-origin: left; } }
@keyframes sr-ring { from { stroke-dasharray: 0 400; } }
`;

function Card({ className, title, right, children, delay = 0 }: { className?: string; title: ReactNode; right?: ReactNode; children: ReactNode; delay?: number }) {
  return (
    <section
      className={cn("sr-rise flex min-w-0 flex-col gap-3 rounded-2xl p-4", className)}
      style={{ background: "var(--glass-row)", border: "1px solid var(--glass-edge)", animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

/** The glass ground every Overview card sits on — blobs behind frosted glass. */
export function GlassGround({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate overflow-hidden rounded-[22px]" style={{ background: "var(--glass-ground)" }}>
      <style>{ANIMATION_CSS}</style>
      <span aria-hidden className="pointer-events-none absolute -left-16 -top-10 size-72 rounded-full blur-[44px]" style={{ background: "var(--glass-blob-a)" }} />
      <span aria-hidden className="pointer-events-none absolute -right-10 top-8 size-64 rounded-full blur-[44px]" style={{ background: "var(--glass-blob-b)" }} />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-80 rounded-full blur-[48px]" style={{ background: "var(--glass-blob-c)" }} />
      <div
        className="relative m-3 flex flex-col gap-3.5 rounded-[18px] p-4 backdrop-blur-[22px] backdrop-saturate-[1.7]"
        style={{ background: "var(--glass)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-shadow)" }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. HERO
// ---------------------------------------------------------------------------

function Metric({ icon: Icon, label, value, sub, tone, delay }: { icon: typeof Package; label: string; value: ReactNode; sub?: ReactNode; tone?: string; delay: number }) {
  return (
    <div className="sr-rise flex min-w-0 flex-col gap-1 rounded-xl px-3.5 py-3" style={{ background: "var(--glass-row)", border: "1px solid var(--glass-edge)", animationDelay: `${delay}ms` }}>
      <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <Icon className="size-3.5" style={tone ? { color: tone } : undefined} aria-hidden />
        {label}
      </span>
      <span className="text-[26px] font-bold leading-none tabular-nums tracking-tight">{value}</span>
      {sub && <span className="min-w-0 text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

export function Hero({ title, orders, today }: { title: string; orders: SeasonOrder[]; today: string }) {
  const t = totalsOf(orders);
  const next = nextDelivery(orders, today);
  const segs = ringSegments(orders);
  const total = segs.reduce((s, x) => s + x.qty, 0);
  const due = next ? dueText(next.order, today) : null;

  return (
    <section className="sr-rise relative overflow-hidden rounded-2xl p-5" style={{ background: "var(--glass-row)", border: "1px solid var(--glass-edge)" }}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Season report</p>
          <h2 className="text-[30px] font-extrabold leading-tight tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {t.orders} order{t.orders === 1 ? "" : "s"} for {t.customers} buyer{t.customers === 1 ? "" : "s"} · as of {fmtDate(today)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[44px] font-extrabold leading-none tabular-nums tracking-tight" style={{ color: "var(--success)" }}>
            {t.shippedPct}
            <span className="text-2xl">%</span>
          </p>
          <p className="text-xs font-medium text-muted-foreground">of the season has shipped</p>
        </div>
      </div>

      {/* The season in one bar: every piece, coloured by where it stands. */}
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full" style={{ background: "var(--glass-edge)" }} role="img" aria-label="Pieces by fulfilment">
        {total > 0 &&
          segs
            .filter((s) => s.qty > 0)
            .map((s, i) => (
              <span
                key={s.key}
                className="sr-sweep h-full"
                title={`${FULFILMENT_LABEL[s.key]} — ${fmtNumber(s.qty)} pcs`}
                style={{ width: `${(s.qty / total) * 100}%`, background: FULFILMENT_COLOR[s.key], animationDelay: `${120 + i * 90}ms` }}
              />
            ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
        <Metric icon={Package} label="Orders" value={t.orders} sub={`${t.customers} buyer${t.customers === 1 ? "" : "s"}`} delay={60} />
        <Metric icon={Shirt} label="Pieces" value={shortQty(t.qty)} sub={`${fmtNumber(t.qty)} committed`} delay={120} />
        <Metric icon={Truck} label="Shipped" value={shortQty(t.shippedQty)} sub={`${t.shippedPct}% of pieces`} tone="var(--success)" delay={180} />
        <Metric icon={Package} label="Balance to ship" value={shortQty(t.balanceQty)} sub={t.late + t.atRisk > 0 ? `${t.late} late · ${t.atRisk} at risk` : "none late or at risk"} tone="var(--primary)" delay={240} />
        <Metric
          icon={CalendarClock}
          label="Next delivery"
          value={next ? (next.days < 0 ? `${-next.days}d late` : next.days === 0 ? "Today" : `${next.days}d`) : "—"}
          sub={next ? <Truncated>{`${next.order.reNo ?? "—"} · ${due?.text ?? ""}`}</Truncated> : "nothing open"}
          tone={due?.bad ? "var(--danger)" : undefined}
          delay={300}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. RING
// ---------------------------------------------------------------------------

export function Ring({ orders }: { orders: SeasonOrder[] }) {
  const segs = ringSegments(orders);
  const total = segs.reduce((s, x) => s + x.qty, 0);
  const t = totalsOf(orders);
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <Card title="Where the pieces stand" delay={80}>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <svg viewBox="0 0 140 140" className="size-36 -rotate-90" role="img" aria-label={`${t.shippedPct}% shipped`}>
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--glass-edge)" strokeWidth="14" />
            {total > 0 &&
              segs.map((s) => {
                if (s.qty <= 0) return null;
                const len = (s.qty / total) * C;
                const el = (
                  <circle
                    key={s.key}
                    className="sr-ring"
                    cx="70"
                    cy="70"
                    r={R}
                    fill="none"
                    stroke={FULFILMENT_COLOR[s.key]}
                    strokeWidth="14"
                    strokeDasharray={`${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`}
                    strokeDashoffset={-offset}
                  >
                    <title>{`${FULFILMENT_LABEL[s.key]} — ${fmtNumber(s.qty)} pcs`}</title>
                  </circle>
                );
                offset += len;
                return el;
              })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-extrabold tabular-nums">{t.shippedPct}%</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">shipped</span>
          </div>
        </div>
        <ul className="grid min-w-0 flex-1 gap-1.5 text-sm">
          {FULFILMENT_ORDER.map((k) => {
            const s = segs.find((x) => x.key === k)!;
            return (
              <li key={k} className="grid grid-cols-[0.7rem_1fr_auto] items-center gap-2 tabular-nums">
                <span className="size-2.5 rounded-sm" style={{ background: FULFILMENT_COLOR[k] }} />
                <span className="min-w-0">
                  {FULFILMENT_LABEL[k]} <span className="text-xs text-muted-foreground">· {s.orders} order{s.orders === 1 ? "" : "s"}</span>
                </span>
                <b>{shortQty(s.qty)}</b>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3. TIMELINE
// ---------------------------------------------------------------------------

export function Timeline({ orders }: { orders: SeasonOrder[] }) {
  const months = byDeliveryMonth(orders);
  const max = Math.max(1, ...months.map((m) => FULFILMENT_ORDER.reduce((s, k) => s + m.qty[k], 0)));
  return (
    <Card title="Deliveries by month" className="lg:col-span-2" delay={140}>
      <div className="flex h-44 items-end gap-2.5 overflow-x-auto pb-1">
        {months.map((m, i) => {
          const sum = FULFILMENT_ORDER.reduce((s, k) => s + m.qty[k], 0);
          return (
            <div key={m.month || "none"} className="group relative flex h-full min-w-12 flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-[11px] font-semibold tabular-nums">{shortQty(sum)}</span>
              <div className="sr-grow flex w-full max-w-14 flex-col-reverse overflow-hidden rounded-t-lg" style={{ height: `${Math.max(4, (sum / max) * 100)}%`, animationDelay: `${i * 70}ms` }}>
                {FULFILMENT_ORDER.map((k) =>
                  m.qty[k] > 0 ? <span key={k} style={{ height: `${(m.qty[k] / sum) * 100}%`, background: FULFILMENT_COLOR[k] }} /> : null,
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">{monthLabel(m.month)}</span>
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full z-10 mb-1 hidden min-w-40 rounded-xl px-3 py-2 text-xs backdrop-blur-md group-hover:block"
                style={{ background: "var(--glass-strong)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-shadow)" }}
              >
                <p className="mb-1 font-bold">
                  {monthLabel(m.month)} · {m.orders} order{m.orders === 1 ? "" : "s"}
                </p>
                {FULFILMENT_ORDER.filter((k) => m.qty[k] > 0).map((k) => (
                  <p key={k} className="grid grid-cols-[0.6rem_1fr_auto] items-center gap-1.5 tabular-nums">
                    <span className="size-2 rounded-sm" style={{ background: FULFILMENT_COLOR[k] }} />
                    <span>{FULFILMENT_LABEL[k]}</span>
                    <b>{fmtNumber(m.qty[k])}</b>
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4. BUYERS
// ---------------------------------------------------------------------------

export function Buyers({ orders }: { orders: SeasonOrder[] }) {
  const rows = byCustomer(orders).slice(0, 7);
  const max = Math.max(1, ...rows.map((r) => r.qty));
  const all = totalsOf(orders).qty || 1;
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Users className="size-3.5" aria-hidden />Buyers</span>} delay={200}>
      <ul className="grid gap-2.5">
        {rows.map((r, i) => (
          <li key={r.customer} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 font-medium"><Truncated>{r.customer}</Truncated></span>
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                <b className="text-sm text-foreground">{shortQty(r.qty)}</b> · {Math.round((r.qty / all) * 100)}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full" style={{ background: "var(--glass-edge)" }}>
              <div className="sr-sweep flex h-full overflow-hidden rounded-full" style={{ width: `${(r.qty / max) * 100}%`, animationDelay: `${i * 70}ms` }}>
                <span style={{ width: `${(r.shippedQty / r.qty) * 100}%`, background: "var(--success)" }} />
                <span className="flex-1" style={{ background: "color-mix(in oklab, var(--primary) 55%, transparent)" }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        <span className="mr-1 inline-block size-2 rounded-sm align-baseline" style={{ background: "var(--success)" }} />
        shipped
        <span className="ml-3 mr-1 inline-block size-2 rounded-sm align-baseline" style={{ background: "color-mix(in oklab, var(--primary) 55%, transparent)" }} />
        still to ship
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 5. ATTENTION
// ---------------------------------------------------------------------------

export function Attention({ orders, today }: { orders: SeasonOrder[]; today: string }) {
  const hot = orders
    .filter((o) => o.riskLevel === "late" || o.riskLevel === "at_risk")
    .sort((a, b) => (a.riskLevel === b.riskLevel ? b.daysLate - a.daysLate : a.riskLevel === "late" ? -1 : 1))
    .slice(0, 6);
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><AlertTriangle className="size-3.5" aria-hidden />Needs chasing</span>} className="lg:col-span-2" delay={260}>
      {hot.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl px-3 py-4 text-sm font-medium" style={{ background: "color-mix(in oklab, var(--success) 12%, transparent)" }}>
          <CheckCircle2 className="size-5" style={{ color: "var(--success)" }} aria-hidden />
          Nothing in this season is late or at risk.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {hot.map((o) => {
            const late = o.riskLevel === "late";
            return (
              <li key={o.salesOrderId}>
                <Link
                  href={`/orders/progress?open=${encodeURIComponent(o.reNo ?? "")}`}
                  className="grid grid-cols-[0.4rem_1fr_auto] items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-surface-muted"
                  style={{ border: "1px solid var(--glass-edge)" }}
                >
                  <span className="h-8 rounded-full" style={{ background: late ? "var(--danger)" : "var(--warning)" }} />
                  <span className="min-w-0">
                    <span className="font-mono text-[13px] font-semibold">{o.reNo ?? "—"}</span>
                    <span className="text-muted-foreground"> · {o.customer ?? "—"}</span>
                    <span className="block text-xs text-muted-foreground"><Truncated>{o.cause ?? dueText(o, today).text}</Truncated></span>
                  </span>
                  <span className="text-right text-xs">
                    <b className="block text-sm" style={{ color: late ? "var(--danger)" : "var(--warning)" }}>
                      {late ? `${o.daysLate}d late` : `${o.daysLate}d slip`}
                    </b>
                    {shortQty(o.balanceQty)} pcs left
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 6. GALLERY
// ---------------------------------------------------------------------------

export function StatusChip({ f }: { f: Fulfilment }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: `color-mix(in oklab, ${FULFILMENT_COLOR[f]} 16%, transparent)`, color: FULFILMENT_COLOR[f] }}
    >
      <span className="size-1.5 rounded-full" style={{ background: FULFILMENT_COLOR[f] }} />
      {FULFILMENT_LABEL[f]}
    </span>
  );
}

/** A style picture, or a quiet monogram tile when the order has none. */
export function Thumb({ order, className }: { order: Pick<SeasonOrder, "thumbnail" | "customer" | "reNo">; className?: string }) {
  if (order.thumbnail) {
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; next/image would proxy and cache it
    return <img src={order.thumbnail} alt="" loading="lazy" className={cn("object-cover", className)} />;
  }
  const initial = (order.customer ?? order.reNo ?? "?").trim().charAt(0).toUpperCase();
  return (
    <div
      aria-hidden
      className={cn("flex items-center justify-center text-2xl font-extrabold", className)}
      style={{ background: "color-mix(in oklab, var(--primary) 10%, transparent)", color: "color-mix(in oklab, var(--primary) 70%, transparent)" }}
    >
      {initial}
    </div>
  );
}

/**
 * EVERY ORDER, COMPACT (client 2026-10-09, "compact it more"). The first cut
 * stacked a full-width 4:3 picture over the details, so eight orders took three
 * screens. A card is now a horizontal strip — a 64px picture, then two short
 * lines of facts and a hairline progress bar — so a season is a glance, not a
 * scroll. Picture and status edge keep their colour: the eye still finds the
 * state first.
 */
export function Gallery({ orders, today }: { orders: SeasonOrder[]; today: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {orders.map((o, i) => {
        const due = dueText(o, today);
        const pct = o.qty > 0 ? Math.min(100, (o.shippedQty / o.qty) * 100) : 0;
        return (
          <Link
            key={o.salesOrderId}
            href={`/orders/${o.salesOrderId}`}
            className="sr-rise flex min-w-0 items-stretch gap-2.5 overflow-hidden rounded-xl p-1.5 pr-2.5 transition-transform hover:-translate-y-0.5"
            style={{
              background: "var(--glass-row)",
              border: "1px solid var(--glass-edge)",
              borderLeft: `3px solid ${FULFILMENT_COLOR[o.fulfilment]}`,
              animationDelay: `${Math.min(i, 12) * 30}ms`,
            }}
          >
            <Thumb order={o} className="size-16 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 py-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 font-mono text-[12.5px] font-bold"><Truncated>{o.reNo ?? "—"}</Truncated></span>
                <StatusChip f={o.fulfilment} />
              </div>
              <div className="flex items-baseline justify-between gap-2 text-[11.5px] leading-tight text-muted-foreground">
                <span className="min-w-0"><Truncated>{o.customer ?? "—"}</Truncated></span>
                <span className="shrink-0 tabular-nums">{o.deliveryDate ? fmtDate(o.deliveryDate) : "No date"}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2 text-[11.5px] tabular-nums">
                <b className="whitespace-nowrap text-[13px]">{fmtNumber(o.qty)} <span className="text-[10.5px] font-medium text-muted-foreground">pcs</span></b>
                <b className="shrink-0" style={{ color: due.bad ? "var(--danger)" : undefined }}>{due.text}</b>
              </div>
              <div className="h-1 overflow-hidden rounded-full" style={{ background: "var(--glass-edge)" }} title={`${fmtNumber(o.shippedQty)} shipped`}>
                <div className="sr-sweep h-full rounded-full" style={{ width: `${pct}%`, background: "var(--success)" }} />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export type { Totals };
