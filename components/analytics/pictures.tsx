import Link from "next/link";
import { Flag } from "lucide-react";
import { Truncated } from "@/components/ui/truncated";
import { Dot, Legend, MOOD_COLOUR, nameColour, type Mood } from "@/components/viz/kit";
import { fmtDate } from "@/lib/format";
import type { Lane, StepState } from "@/lib/analytics/compute";
import { cn } from "@/lib/utils";

/**
 * ONE PICTURE PER ANALYTICS BOARD (plan https://claude.ai/artifact/87etHN8WiMGTnSiK2JLVQh) — the
 * Analytics answer to Store Overview's yarn cones: each draws the subject itself, so the board is
 * understood before a number is read. Every mark carries its figure or word (a title on hover and
 * the value printed beside it); colour is never the only signal. Server-safe.
 */

// ---------------------------------------------------------------------------
// Stages — Overview's journey and Purchase's PO pipeline
// ---------------------------------------------------------------------------

export type Stage = {
  key: string;
  label: string;
  /** The big figure under the box ("12", "3 POs"). */
  figure: string;
  hint: string;
  mood: Mood;
  /** One block per item in the stage, sized by its value — the box fills like a shelf. */
  items: number[];
  href?: string;
};

export function StagePipe({ stages }: { stages: Stage[] }) {
  return (
    <ol className="grid gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
      {stages.map((s, i) => {
        const colour = MOOD_COLOUR[s.mood];
        const max = Math.max(1, ...s.items);
        const shown = s.items.slice(0, 18);
        const box = (
          <>
            <div className="flex h-14 items-end gap-[3px] rounded-[10px] bg-surface-muted p-1.5" title={`${s.label} · ${s.figure}`}>
              {shown.length ? (
                shown.map((v, k) => (
                  <i
                    key={k}
                    className="min-w-0 flex-1 rounded-[3px]"
                    style={{ height: `${30 + (v / max) * 70}%`, background: colour, boxShadow: `0 0 8px -2px ${colour}` }}
                  />
                ))
              ) : (
                <span className="m-auto text-[11px] text-muted-foreground">none</span>
              )}
            </div>
            <div className="mt-1.5 text-lg font-bold tabular-nums">{s.figure}</div>
            <div className="text-xs text-muted-foreground">
              {s.label} · {s.hint}
            </div>
          </>
        );
        return (
          <li key={s.key} className={cn("relative min-w-0 px-3.5", i > 0 && "lg:before:absolute lg:before:-left-1.5 lg:before:top-7 lg:before:size-3 lg:before:rotate-45 lg:before:border-r-2 lg:before:border-t-2 lg:before:border-border-strong lg:before:content-['']")}>
            {s.href ? (
              <Link href={s.href} className="block rounded-lg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {box}
              </Link>
            ) : (
              box
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Shipping calendar — Orders & Buyers
// ---------------------------------------------------------------------------

export type CalMonth = { key: string; label: string; orders: { id: string; reNo: string; buyer: string; qty: number; late?: boolean }[] };

export function ShipCalendar({ months, qtyText }: { months: CalMonth[]; qtyText: (n: number) => string }) {
  if (!months.length) return <p className="px-3.5 py-3 text-sm text-muted-foreground">No order carries a delivery date in this period.</p>;
  const buyers = [...new Set(months.flatMap((m) => m.orders.map((o) => o.buyer)))];
  return (
    <div className="space-y-2.5 px-3.5 py-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {months.map((m) => (
          <div key={m.key} className="w-32 shrink-0">
            <div className="flex min-h-36 flex-col justify-end gap-[3px] rounded-[10px] bg-surface-muted p-1.5">
              {m.orders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/garment-orders?open=${o.id}`}
                  title={`${o.reNo} · ${o.buyer} · ${qtyText(o.qty)}`}
                  className={cn("block min-w-0 rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-semibold text-white hover:opacity-90", o.late && "ring-2 ring-danger")}
                  style={{ background: nameColour(o.buyer) }}
                >
                  <Truncated text={`${o.reNo.replace(/^.*\//, "")} · ${qtyText(o.qty)}`} className="block" />
                </Link>
              ))}
              {m.orders.length === 0 ? <span className="m-auto text-[11px] text-muted-foreground">free</span> : null}
            </div>
            <div className="mt-1 flex justify-between text-xs font-semibold">
              <span>{m.label}</span>
              <span className="tabular-nums text-muted-foreground">{m.orders.length}</span>
            </div>
          </div>
        ))}
      </div>
      <Legend items={buyers.map((b) => ({ label: b, colour: nameColour(b) }))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Margin ladder — Profitability
// ---------------------------------------------------------------------------

export type LadderPoint = { id: string; label: string; pct: number; income: number; href: string; buyer: string };

export function MarginLadder({ points, low, money }: { points: LadderPoint[]; low: number; money: (v: number) => string }) {
  if (!points.length) return <p className="px-3.5 py-3 text-sm text-muted-foreground">No submitted or approved budget in this period.</p>;
  const lo = Math.min(0, Math.floor(Math.min(...points.map((p) => p.pct)) / 10) * 10);
  const hi = Math.max(40, Math.ceil(Math.max(...points.map((p) => p.pct)) / 10) * 10);
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const maxInc = Math.max(...points.map((p) => p.income), 1);
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += 10) ticks.push(t);
  const sorted = [...points].sort((a, b) => a.pct - b.pct);
  return (
    <div className="px-3.5 pb-7 pt-3">
      <div className="relative h-40">
        <div className="absolute inset-y-0 rounded-l bg-danger-soft/70" style={{ left: 0, width: `${x(low)}%`, borderRight: "1px dashed var(--danger)" }} />
        <span className="absolute left-1 top-0 text-[10.5px] font-semibold text-danger">under {low}%</span>
        <div className="absolute inset-x-0 bottom-0 h-px bg-border-strong" />
        {ticks.map((t) => (
          <span key={t} className="absolute -bottom-5 -translate-x-1/2 text-[11px] text-muted-foreground tabular-nums" style={{ left: `${x(t)}%` }}>
            {t}%
          </span>
        ))}
        {sorted.map((p, i) => {
          const size = 12 + (p.income / maxInc) * 20;
          const colour = p.pct < low ? "var(--danger)" : p.pct < 15 ? "var(--warning)" : "var(--primary)";
          const bottom = 14 + (i % 4) * 30;
          return (
            <Link
              key={p.id}
              href={p.href}
              title={`${p.label} · ${p.buyer} · ${p.pct.toFixed(1)}% on ${money(p.income)}`}
              className="group absolute -translate-x-1/2"
              style={{ left: `${x(p.pct)}%`, bottom }}
            >
              <span className="block rounded-full border-2 border-surface" style={{ width: size, height: size, background: colour, boxShadow: `0 0 10px -1px ${colour}` }} />
              <span className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap text-[10.5px] text-muted-foreground group-hover:text-foreground">
                {p.label.replace(/^.*\//, "")}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order runway — Delivery & T&A
// ---------------------------------------------------------------------------

const STEP_COLOUR: Record<StepState, string> = {
  on_time: "var(--success)",
  done_late: "var(--warning)",
  late_open: "var(--danger)",
  upcoming: "var(--border-strong)",
};
const STEP_WORD: Record<StepState, string> = {
  on_time: "Done on time",
  done_late: "Done late",
  late_open: "Late, not done",
  upcoming: "Coming up",
};

export function OrderRunway({ lanes, todayIso }: { lanes: (Lane & { atRisk: boolean })[]; todayIso: string }) {
  if (!lanes.length) return <p className="px-3.5 py-3 text-sm text-muted-foreground">No open order has dated steps.</p>;
  const day = (iso: string) => Date.parse(iso.slice(0, 10));
  return (
    <div className="space-y-1 px-3.5 py-3">
      {lanes.map((l) => {
        const dates = [...l.steps.map((s) => day(s.target)), day(todayIso), ...(l.deliveryDate ? [day(l.deliveryDate)] : [])];
        const a = Math.min(...dates);
        const b = Math.max(...dates);
        const pos = (t: number) => (b === a ? 50 : 3 + ((t - a) / (b - a)) * 94);
        return (
          <div key={l.key} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_5rem] items-center gap-2.5 border-t border-dashed border-border py-1.5 first:border-t-0">
            <div className="min-w-0">
              {l.orderId ? (
                <Link href={`/orders/garment-orders?open=${l.orderId}`} className="text-[12.5px] font-semibold hover:text-primary hover:underline">
                  {l.reNo}
                </Link>
              ) : (
                <span className="text-[12.5px] font-semibold">{l.reNo}</span>
              )}
              <Truncated text={l.buyer} className="block text-[11.5px] text-muted-foreground" />
            </div>
            <div className="relative h-6">
              <span className="absolute inset-x-0 top-[11px] h-0.5 bg-border" />
              <span className="absolute -top-1 -bottom-1 border-l-2 border-dotted border-primary" style={{ left: `${pos(day(todayIso))}%` }} title="Today" />
              {l.steps.map((s, i) => (
                <span
                  key={i}
                  className="absolute top-[5px] size-3.5 -translate-x-1/2 rounded-full border-2 border-surface"
                  style={{ left: `${pos(day(s.target))}%`, background: STEP_COLOUR[s.state], boxShadow: `0 0 8px -1px ${STEP_COLOUR[s.state]}` }}
                  title={`${s.label} · ${fmtDate(s.target)} · ${STEP_WORD[s.state]}`}
                />
              ))}
              {l.deliveryDate ? (
                <Flag className="absolute top-0 size-4 -translate-x-1 text-foreground" style={{ left: `${pos(day(l.deliveryDate))}%` }} aria-label={`Delivery ${fmtDate(l.deliveryDate)}`} />
              ) : null}
            </div>
            <span className={cn("text-right text-xs font-semibold", l.atRisk ? "text-danger" : l.late ? "text-warning" : "text-success")}>
              {l.atRisk ? "At risk" : l.late ? `${l.late} late` : "On track"}
            </span>
          </div>
        );
      })}
      <div className="pt-1.5">
        <Legend items={(Object.keys(STEP_WORD) as StepState[]).map((k) => ({ label: STEP_WORD[k], colour: STEP_COLOUR[k] })).concat([{ label: "Today (dotted line) · ⚑ delivery", colour: "var(--primary)" }])} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel — Samples & Enquiries
// ---------------------------------------------------------------------------

export function Funnel({ steps }: { steps: { key: string; label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="space-y-1.5 px-3.5 py-3">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].value : 0;
        return (
          <div key={s.key} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_minmax(0,9rem)] items-center gap-2.5 text-[12.5px]">
            <span>{s.label}</span>
            <span
              className="mx-auto grid h-7 place-items-center rounded-md text-xs font-bold text-white"
              style={{
                width: `${Math.max(8, (s.value / top) * 100)}%`,
                background: s.value ? "var(--primary)" : "var(--border-strong)",
                opacity: 1 - i * 0.1,
                boxShadow: "0 0 12px -3px var(--primary)",
              }}
              title={`${s.label} · ${s.value}`}
            >
              {s.value}
            </span>
            <span className="text-xs text-muted-foreground">{i && prev ? `${Math.round((s.value / prev) * 100)}% of the step before` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People grid — People & Workplace
// ---------------------------------------------------------------------------

export function PeopleGrid({ depts }: { depts: { name: string; count: number; off: number }[] }) {
  if (!depts.length) return <p className="px-3.5 py-3 text-sm text-muted-foreground">No active staff.</p>;
  return (
    <div className="grid gap-2 px-3.5 py-3 sm:grid-cols-2 lg:grid-cols-4">
      {depts.map((d) => (
        <div key={d.name} className="min-w-0 rounded-[10px] bg-surface-muted px-2.5 py-2" title={`${d.name} · ${d.count} active · ${d.off} on leave today`}>
          <div className="flex justify-between gap-2 text-xs font-semibold">
            <Truncated text={d.name} className="block min-w-0" />
            <span className="tabular-nums">{d.count}</span>
          </div>
          <div className="my-1.5 flex flex-wrap gap-[3px]" aria-hidden>
            {Array.from({ length: Math.min(d.count, 60) }, (_, i) => (
              <i key={i} className="h-3 w-2 rounded-t-[4px] rounded-b-[2px]" style={{ background: i >= d.count - d.off ? "var(--warning)" : "var(--primary)" }} />
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {d.off ? <Dot colour="var(--warning)" /> : null}
            {d.off ? `${d.off} on leave today` : "all in"}
            {d.count > 60 ? ` · first 60 drawn` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
