"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  BUCKET_COLOR,
  BUCKET_LABEL,
  BUCKETS_OPEN,
  WEEKS,
  byUrgency,
  holdingText,
  niceStep,
  shortQty,
  weekStart,
  type OpenBucket,
  type ProgressItem,
} from "@/lib/orders/progress/view";
import type { StageGroup } from "@/lib/orders/progress/engine";
import { Truncated } from "@/components/ui/truncated";
import type { Drill, Unit } from "./progress-screen";

/**
 * Order Progress ▸ Overview — five questions, in the approved glass look
 * (components/orders/budget-breakdown-chart.tsx is the reference):
 *
 *   1. How healthy is the order book?   → ring, on-time share in the centre
 *   2. What is due, and when?           → dot field: every dot is one order
 *   3. Where are orders waiting?        → metro map of the 15 stages
 *      (2 and 3 share one card behind a toggle)
 *   4. Who needs help?                  → customers / merchandisers ranked
 *   5. What do I chase today?           → the most urgent orders
 *
 * Grey means fine, colour means it needs someone. Every part is clickable and
 * opens the Orders view filtered to it.
 */

type Counts = Record<OpenBucket, number>;
const zero = (): Counts => ({ late: 0, risk: 0, none: 0, ok: 0 });

type Tip = { x: number; y: number; body: ReactNode } | null;

function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  const left = Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 280);
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 min-w-44 max-w-64 rounded-xl px-3 py-2.5 text-xs backdrop-blur-md"
      style={{ left, top: tip.y + 14, background: "var(--glass-strong)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-shadow)" }}
    >
      {tip.body}
    </div>
  );
}

function tipRows(title: string, c: Counts, show: (n: number) => string, foot?: string) {
  return (
    <>
      <p className="mb-1.5 text-xs font-bold">{title}</p>
      {BUCKETS_OPEN.filter((k) => c[k]).map((k) => (
        <p key={k} className="grid grid-cols-[0.6rem_1fr_auto] items-center gap-1.5 tabular-nums">
          <span className="size-2 rounded-sm" style={{ background: BUCKET_COLOR[k] }} />
          <span>{BUCKET_LABEL[k]}</span>
          <b>{show(c[k])}</b>
        </p>
      ))}
      {foot && <p className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground" style={{ borderColor: "var(--glass-edge)" }}>{foot}</p>}
    </>
  );
}

function Card({ className, title, right, children }: { className?: string; title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-2 rounded-2xl p-4", className)}
      style={{ background: "var(--glass-row)", border: "1px solid var(--glass-edge)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Overview({ items, today, unit, drill }: { items: ProgressItem[]; today: string; unit: Unit; drill: Drill }) {
  const open = items.filter((i) => i.bucket !== "done") as (ProgressItem & { bucket: OpenBucket })[];
  const val = (i: ProgressItem) => (unit === "pieces" ? i.qty : 1);
  const show = (n: number) => (unit === "pieces" ? shortQty(n) : fmtNumber(n));
  const word = unit === "pieces" ? "pcs" : "orders";
  const [tip, setTip] = useState<Tip>(null);
  const [flow, setFlow] = useState<"weeks" | "stages">("weeks");
  const [by, setBy] = useState<"customer" | "merchandiser">("customer");

  if (!open.length) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        No open orders match. Orders appear here once they are saved on Order Entry (not as a draft).
      </p>
    );
  }

  return (
    <div className="relative isolate overflow-hidden rounded-[22px]" style={{ background: "var(--glass-ground)" }}>
      <span aria-hidden className="pointer-events-none absolute -left-16 -top-10 size-72 rounded-full blur-[44px]" style={{ background: "var(--glass-blob-a)" }} />
      <span aria-hidden className="pointer-events-none absolute -right-10 top-8 size-64 rounded-full blur-[44px]" style={{ background: "var(--glass-blob-b)" }} />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-80 rounded-full blur-[48px]" style={{ background: "var(--glass-blob-c)" }} />
      <div
        className="relative m-3 grid gap-3.5 rounded-[18px] p-4 backdrop-blur-[22px] backdrop-saturate-[1.7] lg:grid-cols-3"
        style={{ background: "var(--glass)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-shadow)" }}
      >
        <Health open={open} val={val} show={show} word={word} drill={drill} />
        <Card
          className="lg:col-span-2"
          title={
            <span role="tablist" aria-label="Chart" className="inline-flex rounded-lg p-0.5" style={{ background: "var(--glass-track)", border: "1px solid var(--glass-edge)" }}>
              {(
                [
                  ["weeks", "Deliveries by week"],
                  ["stages", "Where orders wait"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={flow === k}
                  onClick={() => setFlow(k)}
                  className={cn(
                    "h-7 rounded-md px-3 text-[11px] font-semibold uppercase tracking-[0.06em]",
                    flow === k ? "bg-surface text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </span>
          }
        >
          {flow === "weeks" ? (
            <Weeks open={open} today={today} unit={unit} val={val} show={show} word={word} drill={drill} setTip={setTip} />
          ) : (
            <Metro open={open} val={val} show={show} word={word} drill={drill} setTip={setTip} />
          )}
        </Card>
        <Owners open={open} by={by} setBy={setBy} val={val} show={show} drill={drill} setTip={setTip} />
        <Attention open={open} drill={drill} />
      </div>
      <TipBox tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Delivery health — the approval chart's ring
// ---------------------------------------------------------------------------

function Health({
  open,
  val,
  show,
  word,
  drill,
}: {
  open: (ProgressItem & { bucket: OpenBucket })[];
  val: (i: ProgressItem) => number;
  show: (n: number) => string;
  word: string;
  drill: Drill;
}) {
  const [hover, setHover] = useState<OpenBucket | null>(null);
  const n = zero();
  for (const i of open) n[i.bucket] += val(i);
  const total = BUCKETS_OPEN.reduce((a, k) => a + n[k], 0) || 1;
  const pct = (k: OpenBucket) => Math.round((n[k] / total) * 100);

  // Arcs clockwise from 12 o'clock; a small share still gets room to be seen
  // (the approval chart's MIN_SPAN rule, screenshot 3164).
  const R = 78, C = 2 * Math.PI * R, TRIM = 14, MIN = TRIM + 12, STROKE = 18;
  const order: OpenBucket[] = ["late", "risk", "none", "ok"];
  const raw = order.map((k) => (n[k] / total) * C);
  const small = raw.map((v) => v > 0 && v < MIN);
  const big = raw.reduce((a, v, i) => a + (small[i] ? 0 : v), 0);
  const sc = big > 0 ? Math.max(0, C - small.filter(Boolean).length * MIN) / big : 1;
  let at = 0;
  const arcs = order.map((k, i) => {
    const span = raw[i] <= 0 ? 0 : small[i] ? MIN : raw[i] * sc;
    const a = { k, start: at + TRIM / 2, len: Math.max(0.1, span - TRIM), on: span > 0 };
    at += span;
    return a;
  });
  const centre = hover
    ? { label: BUCKET_LABEL[hover], value: `${pct(hover)}%`, sub: `${show(n[hover])} ${word}`, color: BUCKET_COLOR[hover] }
    : { label: "On time", value: `${pct("ok")}%`, sub: `${show(total)} ${word} open`, color: undefined };
  const max = Math.max(1, ...order.map((k) => n[k]));

  return (
    <Card title="Delivery health" right={<span className="text-[11px] text-muted-foreground">by {word === "pcs" ? "pieces" : "orders"}</span>}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative size-44 shrink-0" onPointerLeave={() => setHover(null)}>
          <svg viewBox="0 0 200 200" className="size-full -rotate-90 overflow-visible" aria-hidden>
            <circle cx="100" cy="100" r={R} fill="none" strokeWidth={STROKE} style={{ stroke: "var(--glass-track)" }} />
            {arcs
              .filter((a) => a.on)
              .map((a) => (
                <circle
                  key={a.k}
                  cx="100"
                  cy="100"
                  r={R}
                  fill="none"
                  stroke={BUCKET_COLOR[a.k]}
                  strokeWidth={hover === a.k ? STROKE + 6 : STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${a.len} ${C}`}
                  strokeDashoffset={-a.start}
                  className="viz-slice cursor-pointer transition-[opacity,stroke-width] duration-200"
                  style={{ opacity: hover && hover !== a.k ? 0.25 : 1, filter: `drop-shadow(0 0 ${hover === a.k ? 10 : 4}px ${BUCKET_COLOR[a.k]})` }}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setHover(a.k)}
                  onClick={() => drill({ segment: a.k })}
                />
              ))}
          </svg>
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 flex size-[6.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center backdrop-blur-md"
            style={{ background: "var(--glass-disc)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-disc-shadow)" }}
          >
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{centre.label}</span>
            <span className="text-[1.6rem] font-bold leading-[1.1] tracking-tight tabular-nums" style={centre.color ? { color: centre.color } : undefined}>
              {centre.value}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{centre.sub}</span>
          </div>
        </div>
        <ul className="grid min-w-44 flex-1 gap-1.5">
          {(["late", "risk", "ok", "none"] as const).map((k) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => drill({ segment: k })}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHover(k)}
                onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
                className={cn(
                  "grid w-full grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-xl px-2.5 py-1.5 text-left transition-[opacity,background] duration-200",
                  hover && hover !== k && "opacity-45",
                )}
                style={{ background: hover === k ? "var(--glass-strong)" : "var(--glass-row)", border: "1px solid var(--glass-edge)" }}
              >
                <span className="size-2.5 rounded-full" style={{ background: BUCKET_COLOR[k], boxShadow: `0 0 8px ${BUCKET_COLOR[k]}` }} />
                <span className="text-[13px] font-medium">{BUCKET_LABEL[k]}</span>
                <span className="text-right text-[13px] font-bold tabular-nums">{show(n[k])}</span>
                <span className="col-start-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--glass-track)" }}>
                  <span className="viz-grow block h-full rounded-full" style={{ width: `${(n[k] / max) * 100}%`, background: BUCKET_COLOR[k] }} />
                </span>
                <span className="text-right text-[11px] tabular-nums text-muted-foreground">{pct(k)}%</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2. Deliveries by week — a dot field, every dot one order (or N pieces)
// ---------------------------------------------------------------------------

const DOT_ORDER: OpenBucket[] = ["late", "risk", "none", "ok"];

function Weeks({
  open,
  today,
  unit,
  val,
  show,
  word,
  drill,
  setTip,
}: {
  open: (ProgressItem & { bucket: OpenBucket })[];
  today: string;
  unit: Unit;
  val: (i: ProgressItem) => number;
  show: (n: number) => string;
  word: string;
  drill: Drill;
  setTip: (t: Tip) => void;
}) {
  const W = Array.from({ length: WEEKS + 1 }, () => ({ c: zero(), items: [] as (ProgressItem & { bucket: OpenBucket })[] }));
  let later = 0, laterBad = 0, undated = 0;
  for (const i of open) {
    if (i.week < 0) undated += val(i);
    else if (i.week > WEEKS) {
      later += val(i);
      if (i.bucket === "late" || i.bucket === "risk") laterBad += val(i);
    } else {
      W[i.week].c[i.bucket] += val(i);
      W[i.week].items.push(i);
    }
  }
  const tot = (c: Counts) => c.late + c.risk + c.none + c.ok;
  const next4 = W.slice(1, 5).reduce((a, w) => a + tot(w.c), 0);
  const bad4 = W.slice(1, 5).reduce((a, w) => a + w.c.late + w.c.risk, 0);
  const per = unit === "pieces" ? niceStep(Math.max(1, ...W.map((w) => tot(w.c))) / 66) : 1;
  const label = (w: number) => (w ? `Week of ${fmtDate(weekStart(today, w))}` : "Past delivery date");
  const month = (w: number) => (w ? new Date(`${weekStart(today, w)}T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }) : "");
  const bands: { from: number; to: number; m: string }[] = [];
  for (let w = 1; w <= WEEKS; w++) {
    const m = month(w);
    if (bands.length && bands[bands.length - 1].m === m) bands[bands.length - 1].to = w;
    else bands.push({ from: w, to: w, m });
  }

  return (
    <div className="flex min-h-[21rem] flex-col">
      <p className="text-[12.5px] text-muted-foreground">
        <b className="text-danger">{show(tot(W[0].c))}</b> {word} already past delivery · <b className="text-foreground">{show(next4)}</b> due in the next 4
        weeks, <b className="text-danger">{show(bad4)}</b> of them late or at risk
      </p>
      <div className="mt-2 grid flex-1 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-1.5 sm:gap-2">
        {W.map((w, wi) => {
          const n = tot(w.c);
          const dots: { k: OpenBucket; item?: ProgressItem }[] =
            unit === "pieces"
              ? DOT_ORDER.flatMap((k) => Array.from({ length: Math.round(w.c[k] / per) }, () => ({ k })))
              : [...w.items].sort((a, b) => DOT_ORDER.indexOf(a.bucket) - DOT_ORDER.indexOf(b.bucket)).map((i) => ({ k: i.bucket, item: i }));
          return (
            <div
              key={wi}
              role="button"
              tabIndex={0}
              aria-label={`${label(wi)}: ${n} ${word}`}
              className="flex h-full min-w-0 cursor-pointer flex-col items-center justify-end gap-1.5 rounded-xl px-0.5 pb-1 pt-1.5 hover:bg-[var(--glass-strong)] focus-visible:bg-[var(--glass-strong)] focus-visible:outline-none"
              onClick={() => drill({ week: wi })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  drill({ week: wi });
                }
              }}
              onPointerMove={(e) => {
                const re = (e.target as HTMLElement).dataset?.re;
                const it = re ? w.items.find((x) => x.row.salesOrderId === re) : undefined;
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  body: it ? (
                    <>
                      <p className="mb-1 font-mono text-xs font-bold">{it.row.orderNumber}</p>
                      <p className="grid grid-cols-[0.6rem_1fr_auto] items-center gap-1.5">
                        <span className="size-2 rounded-sm" style={{ background: BUCKET_COLOR[it.bucket] }} />
                        <span>{BUCKET_LABEL[it.bucket]}</span>
                        <b>{it.lateBy ? `${it.lateBy}d late` : ""}</b>
                      </p>
                      <p className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground" style={{ borderColor: "var(--glass-edge)" }}>
                        {it.row.customer ?? "—"} · {fmtNumber(it.qty)} pcs · due {fmtDate(it.row.deliveryDate)}
                        <br />
                        Click to open this order
                      </p>
                    </>
                  ) : (
                    tipRows(label(wi), w.c, show, "Click to see these orders")
                  ),
                });
              }}
              onPointerLeave={() => setTip(null)}
            >
              <span className={cn("text-[11px] font-bold tabular-nums", wi === 0 ? "text-danger" : "text-foreground")}>{n ? show(n) : ""}</span>
              <span className="flex w-[3.7rem] max-w-full flex-wrap-reverse content-start gap-[3px]">
                {dots.map((d, j) => (
                  <i
                    key={j}
                    data-re={d.item?.row.salesOrderId}
                    onClick={
                      d.item
                        ? (e) => {
                            e.stopPropagation();
                            setTip(null);
                            drill({ open: d.item!.row.salesOrderId });
                          }
                        : undefined
                    }
                    className="block size-2 rounded-full transition-transform hover:scale-[1.8]"
                    style={{
                      background: d.k === "ok" ? "color-mix(in srgb, var(--success) 42%, transparent)" : d.k === "none" ? "color-mix(in srgb, var(--muted-foreground) 25%, transparent)" : BUCKET_COLOR[d.k],
                      boxShadow: d.k === "late" || d.k === "risk" ? `0 0 6px ${BUCKET_COLOR[d.k]}` : d.k === "none" ? "inset 0 0 0 1px var(--muted-foreground)" : undefined,
                    }}
                  />
                ))}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1.5 text-center text-[10.5px] tabular-nums text-muted-foreground sm:gap-2">
        {W.map((_, wi) => (
          <span key={wi} className={cn(wi === 0 && "font-bold text-danger", wi % 2 === 0 && wi > 0 && "max-sm:invisible")}>
            {wi ? fmtDate(weekStart(today, wi)).slice(0, 5) : "Past"}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1.5 sm:gap-2">
        {bands.map((b) => (
          <span
            key={b.from}
            className="whitespace-nowrap border-t-2 pt-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
            style={{ gridColumn: `${b.from + 1} / ${b.to + 2}`, borderColor: "var(--glass-track)" }}
          >
            {b.m}
          </span>
        ))}
      </div>
      <Legend
        lead={unit === "pieces" ? `● = ${fmtNumber(per)} pcs` : "● = 1 order"}
        tail={[later ? `After 13 weeks: ${show(later)}${laterBad ? ` (${show(laterBad)} at risk)` : ""}` : "", undated ? `No delivery date: ${show(undated)}` : ""].filter(Boolean).join(" · ")}
      />
    </div>
  );
}

function Legend({ lead, tail, onPlan }: { lead: string; tail?: string; onPlan?: boolean }) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-3 text-[11.5px] text-muted-foreground">
      <span className="font-semibold text-foreground">{lead}</span>
      {(["late", "risk", "ok", "none"] as const).map((k) =>
        onPlan && k === "none" ? null : (
          <span key={k} className="inline-flex items-center gap-1.5">
            <i className="size-2.5 rounded-full" style={{ background: k === "ok" ? "color-mix(in srgb, var(--success) 42%, transparent)" : k === "none" ? "color-mix(in srgb, var(--muted-foreground) 25%, transparent)" : BUCKET_COLOR[k] }} />
            {onPlan && k === "ok" ? "On plan" : BUCKET_LABEL[k]}
          </span>
        ),
      )}
      {tail && <span className="ml-auto">{tail}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Where orders wait — the 15 stages as a two-row metro map
// ---------------------------------------------------------------------------

const PHASE_COLOR: Record<StageGroup, string> = {
  office: "var(--viz-1)",
  material: "var(--viz-3)",
  production: "var(--viz-2)",
  shipment: "var(--viz-5)",
};
const PHASE_LABEL: Record<StageGroup, string> = { office: "Office", material: "Material", production: "Production", shipment: "Shipment" };

function Metro({
  open,
  val,
  show,
  word,
  drill,
  setTip,
}: {
  open: (ProgressItem & { bucket: OpenBucket })[];
  val: (i: ProgressItem) => number;
  show: (n: number) => string;
  word: string;
  drill: Drill;
  setTip: (t: Tip) => void;
}) {
  const stages = open[0].row.progress.stages.map((s) => ({ key: s.key, label: s.label, group: s.group }));
  const S = stages.map(() => zero());
  for (const i of open) if (i.cur >= 0) S[i.cur][i.bucket] += val(i);
  const tot = (c: Counts) => c.late + c.risk + c.none + c.ok;
  const bad = (c: Counts) => c.late + c.risk;
  const max = Math.max(1, ...S.map(tot));
  const peak = S.reduce((p, c, i) => (bad(c) > bad(S[p]) ? i : p), 0);
  const any = S.some((c) => bad(c) > 0);
  const behind = S.reduce((a, c) => a + bad(c), 0);
  const waiting = S.reduce((a, c) => a + tot(c), 0);

  // Row 1 = Office, left → right; row 2 = everything after it, right → left.
  const row1 = stages.map((s, i) => (s.group === "office" ? i : -1)).filter((i) => i >= 0);
  const row2 = stages.map((s, i) => (s.group !== "office" ? i : -1)).filter((i) => i >= 0);
  const Y1 = 78, Y2 = 238, L = 70, R = 830;
  const pos: { x: number; y: number }[] = [];
  row1.forEach((si, k) => (pos[si] = { x: L + (k * (R - L)) / Math.max(1, row1.length - 1), y: Y1 }));
  row2.forEach((si, k) => (pos[si] = { x: R - (k * (R - L)) / Math.max(1, row2.length - 1), y: Y2 }));
  const turnAfter = row1[row1.length - 1];
  const nameLines = (label: string) => {
    const w = label.split(" ");
    if (label.length <= 11 || w.length < 2) return [label];
    const h = Math.ceil(w.length / 2);
    return [w.slice(0, h).join(" "), w.slice(h).join(" ")];
  };
  const phases = (["office", "material", "production", "shipment"] as const)
    .map((g) => {
      const idx = stages.map((s, i) => (s.group === g ? i : -1)).filter((i) => i >= 0);
      return idx.length ? { g, x: (pos[idx[0]].x + pos[idx[idx.length - 1]].x) / 2, y: g === "office" ? 22 : Y2 + 88 } : null;
    })
    .filter((p): p is { g: StageGroup; x: number; y: number } => !!p);

  return (
    <div className="flex min-h-[21rem] flex-col">
      <p className="text-[12.5px] text-muted-foreground">
        {any ? (
          <>
            <b className="text-danger">{show(behind)}</b> of {show(waiting)} {word} behind plan · biggest hold-up:{" "}
            <b className="text-danger">{stages[peak].label}</b> ({show(bad(S[peak]))} of {show(tot(S[peak]))})
          </>
        ) : (
          `${show(waiting)} ${word} in progress — no stage has orders behind plan`
        )}
      </p>
      <div className="flex flex-1 items-center overflow-x-auto">
        <svg viewBox="0 0 900 340" className="w-full min-w-[37rem]" role="img" aria-label="Orders waiting at each stage">
          {stages.slice(0, -1).map((_, i) => {
            const a = pos[i], b = pos[i + 1];
            const c = PHASE_COLOR[stages[i + 1].group];
            const d =
              i === turnAfter
                ? `M ${a.x} ${a.y} H ${a.x + 40} Q ${a.x + 70} ${a.y} ${a.x + 70} ${a.y + 30} V ${b.y - 30} Q ${a.x + 70} ${b.y} ${a.x + 40} ${b.y} H ${b.x}`
                : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
            const dir = a.y === Y1 ? 1 : -1;
            const mx = (a.x + b.x) / 2;
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={c} strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" opacity={0.16} />
                <path d={d} fill="none" stroke={c} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
                {i !== turnAfter && (
                  <path d={`M ${mx - 4 * dir} ${a.y - 5} L ${mx + 3 * dir} ${a.y} L ${mx - 4 * dir} ${a.y + 5}`} fill="none" stroke="var(--surface)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                )}
              </g>
            );
          })}
          {phases.map((p) => (
            <text key={p.g} x={p.x} y={p.y} textAnchor="middle" fill={PHASE_COLOR[p.g]} fontSize={11} fontWeight={700} letterSpacing="0.1em">
              {PHASE_LABEL[p.g].toUpperCase()}
            </text>
          ))}
          {stages.map((s, i) => {
            const c = S[i];
            const t = tot(c);
            // An empty stop is a small hollow station with no number, so the stages that hold orders stand out.
            const r = t ? 14 + Math.sqrt(t / max) * 13 : 7;
            const { x, y } = pos[i];
            const C = 2 * Math.PI * (r + 5);
            const lateLen = t ? (c.late / t) * C : 0;
            const riskLen = t ? (c.risk / t) * C : 0;
            const pk = i === peak && any;
            const lines = nameLines(s.label);
            return (
              <g
                key={s.key}
                role="button"
                tabIndex={0}
                aria-label={`${s.label}: ${t} waiting, ${bad(c)} behind plan`}
                className="cursor-pointer focus-visible:outline-none [&:focus-visible_.core]:stroke-[var(--primary)] [&:hover_.core]:stroke-[var(--primary)]"
                onClick={() => {
                  setTip(null);
                  drill({ stage: i });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    drill({ stage: i });
                  }
                }}
                onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: tipRows(s.label, c, show, "Orders whose current stage is this one") })}
                onPointerLeave={() => setTip(null)}
              >
                {pk && <circle cx={x} cy={y} r={r + 9} fill="none" stroke="var(--danger)" strokeWidth={2} className="origin-center animate-ping [transform-box:fill-box]" opacity={0.5} />}
                {t > 0 && <circle cx={x} cy={y} r={r + 5} fill="none" stroke="color-mix(in srgb, var(--success) 42%, transparent)" strokeWidth={5} />}
                {lateLen > 0 && (
                  <circle cx={x} cy={y} r={r + 5} fill="none" stroke="var(--danger)" strokeWidth={5} strokeDasharray={`${lateLen} ${C}`} transform={`rotate(-90 ${x} ${y})`} style={{ filter: "drop-shadow(0 0 4px var(--danger))" }} />
                )}
                {riskLen > 0 && (
                  <circle cx={x} cy={y} r={r + 5} fill="none" stroke="var(--warning)" strokeWidth={5} strokeDasharray={`${riskLen} ${C}`} strokeDashoffset={-lateLen} transform={`rotate(-90 ${x} ${y})`} style={{ filter: "drop-shadow(0 0 4px var(--warning))" }} />
                )}
                <circle className="core" cx={x} cy={y} r={r} fill="var(--surface)" stroke={t ? "var(--glass-edge)" : "var(--border-strong)"} strokeWidth={t ? 1.5 : 2} />
                {t > 0 && (
                  <text x={x} y={y + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--foreground)" className="tabular-nums">
                    {show(t)}
                  </text>
                )}
                {bad(c) > 0 && (
                  <g transform={`translate(${x + r * 0.75} ${y - r - 8})`}>
                    <rect x={-13} y={-9} width={26} height={17} rx={8.5} fill="var(--danger)" />
                    <text x={0} y={3.5} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff">
                      {show(bad(c))}
                    </text>
                  </g>
                )}
                {lines.map((ln, li) => (
                  <text key={li} x={x} y={y + r + 24 + li * 15} textAnchor="middle" fontSize={12.5} fontWeight={pk ? 700 : 400} fill={pk ? "var(--danger)" : "var(--muted-foreground)"}>
                    {ln}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <Legend lead="Station size = orders waiting" tail="Red badge = behind plan · click a station to see its orders" onPlan />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Who needs help — customers or merchandisers, ranked
// ---------------------------------------------------------------------------

function Owners({
  open,
  by,
  setBy,
  val,
  show,
  drill,
  setTip,
}: {
  open: (ProgressItem & { bucket: OpenBucket })[];
  by: "customer" | "merchandiser";
  setBy: (b: "customer" | "merchandiser") => void;
  val: (i: ProgressItem) => number;
  show: (n: number) => string;
  drill: Drill;
  setTip: (t: Tip) => void;
}) {
  const M = new Map<string, Counts>();
  for (const i of open) {
    const k = (by === "customer" ? i.row.customer : i.row.merchandiser) ?? (by === "customer" ? "No customer" : "No merchandiser");
    if (!M.has(k)) M.set(k, zero());
    M.get(k)![i.bucket] += val(i);
  }
  const ranked = [...M.entries()]
    .map(([k, c]) => ({ k, c, bad: c.late + c.risk, t: c.late + c.risk + c.none + c.ok }))
    .sort((a, b) => b.bad - a.bad || b.t - a.t);
  const top = ranked.slice(0, 8);
  const max = Math.max(1, ...top.map((r) => r.t));
  const badAll = ranked.reduce((a, r) => a + r.bad, 0);
  const top3 = top.slice(0, 3).reduce((a, r) => a + r.bad, 0);
  const noun = by === "customer" ? "customers" : "merchandisers";

  return (
    <Card
      title="Who needs help"
      right={
        <span role="group" aria-label="Group by" className="inline-flex rounded-md p-0.5" style={{ background: "var(--glass-track)", border: "1px solid var(--glass-edge)" }}>
          {(["customer", "merchandiser"] as const).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={by === b}
              onClick={() => setBy(b)}
              className={cn("h-6 rounded px-2 text-[11px] font-semibold capitalize", by === b ? "bg-surface text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}
            >
              {b}
            </button>
          ))}
        </span>
      }
    >
      <p className="text-[12.5px] text-muted-foreground">
        {badAll ? (
          <>
            The top 3 {noun} hold <b className="text-danger">{Math.round((top3 / badAll) * 100)}%</b> of everything late or at risk
          </>
        ) : (
          "Nothing is late or at risk"
        )}
      </p>
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_4rem] gap-2.5 border-b px-1.5 pb-1 text-[11px] text-muted-foreground" style={{ borderColor: "var(--glass-edge)" }}>
        <span className="capitalize">{by}</span>
        <span>Late · at risk · on track</span>
        <span className="text-right">Need help</span>
      </div>
      <div className="grid gap-0.5">
        {top.map((r) => (
          <button
            key={r.k}
            type="button"
            onClick={() => {
              setTip(null);
              drill(by === "customer" ? { customer: r.k } : { merch: r.k });
            }}
            onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: tipRows(r.k, r.c, show, "Click to see their orders") })}
            onPointerLeave={() => setTip(null)}
            className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_4rem] items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--glass-strong)]"
          >
            <Truncated text={r.k} />
            <span className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--glass-track)" }}>
              {(["late", "risk", "none", "ok"] as const).map((k) =>
                r.c[k] ? (
                  <i
                    key={k}
                    className="block h-full"
                    style={{
                      width: `${(r.c[k] / max) * 100}%`,
                      background: k === "ok" ? "color-mix(in srgb, var(--success) 42%, transparent)" : k === "none" ? "color-mix(in srgb, var(--muted-foreground) 25%, transparent)" : BUCKET_COLOR[k],
                    }}
                  />
                ) : null,
              )}
            </span>
            <span className="text-right tabular-nums">
              <b className={r.bad ? "text-danger" : "text-success"}>{show(r.bad)}</b> <span className="text-[11px] text-muted-foreground">of {show(r.t)}</span>
            </span>
          </button>
        ))}
      </div>
      {ranked.length > top.length && <p className="text-[11px] text-muted-foreground">{ranked.length - top.length} more {noun} not shown</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 5. Needs attention now
// ---------------------------------------------------------------------------

function Attention({ open, drill }: { open: (ProgressItem & { bucket: OpenBucket })[]; drill: Drill }) {
  const list = open.filter((i) => i.bucket === "late" || i.bucket === "risk").sort(byUrgency).slice(0, 8);
  return (
    <Card
      className="lg:col-span-2"
      title="Needs attention now"
      right={
        <button type="button" onClick={() => drill({ sort: "urgent" })} className="text-xs font-semibold text-primary hover:underline">
          See all →
        </button>
      }
    >
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing needs attention. Every open order is on plan.</p>
      ) : (
        <div role="table" aria-label="Orders needing attention" className="text-[12.5px]">
          <div role="row" className="grid h-7 grid-cols-[10rem_minmax(0,1.2fr)_minmax(0,1fr)_4rem_3.5rem] items-center gap-2.5 border-b px-2.5 text-[11px] text-muted-foreground max-sm:hidden" style={{ borderColor: "var(--glass-edge)" }}>
            <span role="columnheader">RE No</span>
            <span role="columnheader">Customer</span>
            <span role="columnheader">Holding it up</span>
            <span role="columnheader" className="text-right">Late</span>
            <span role="columnheader" className="text-right">Due</span>
          </div>
          {list.map((i) => (
            <div
              key={i.row.salesOrderId}
              role="row"
              tabIndex={0}
              onClick={() => drill({ open: i.row.salesOrderId })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  drill({ open: i.row.salesOrderId });
                }
              }}
              className="grid h-9 cursor-pointer grid-cols-[10rem_minmax(0,1.2fr)_minmax(0,1fr)_4rem_3.5rem] items-center gap-2.5 rounded-lg px-2.5 hover:bg-[var(--glass-strong)] focus-visible:bg-[var(--glass-strong)] focus-visible:outline-none max-sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span role="cell" className="flex items-center gap-2 whitespace-nowrap font-mono text-xs font-medium">
                <i className="size-2 shrink-0 rounded-full" style={{ background: BUCKET_COLOR[i.bucket], boxShadow: `0 0 6px ${BUCKET_COLOR[i.bucket]}` }} />
                {i.row.orderNumber}
              </span>
              <span role="cell" className="min-w-0 max-sm:hidden">
                <Truncated text={i.row.customer ?? "—"} />
              </span>
              <span role="cell" className="min-w-0 text-muted-foreground max-sm:hidden">
                <Truncated text={holdingText(i)} />
              </span>
              <span role="cell" className="text-right font-bold tabular-nums" style={{ color: BUCKET_COLOR[i.bucket] }}>
                {i.lateBy}d
              </span>
              <span role="cell" className="text-right tabular-nums max-sm:hidden">
                {fmtDate(i.row.deliveryDate).slice(0, 5)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
