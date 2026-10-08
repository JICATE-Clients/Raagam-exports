"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber } from "@/lib/format";
import { usePref } from "@/lib/ui/use-pref";
import { usePagination } from "@/lib/use-pagination";
import type { ProfitOrderRow } from "@/lib/orders/profitability/types";
import {
  STAGE_LABEL,
  bridge,
  isComparable,
  lakh,
  meters,
  resultOf,
  rupees,
  toBvaItem,
  watchList,
  type BvaItem,
  type BvaStage,
} from "@/lib/orders/profitability/view";
import { MARGIN_TARGET_PCT } from "@/lib/orders/budget/breakdown";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { PaginationBar } from "@/components/ui/pagination";
import { Truncated } from "@/components/ui/truncated";
import { ToggleGroup } from "@/components/ui/segmented";

/**
 * Orders ▸ Order Management ▸ Order Profit Check — the client half
 * (doc/order/digitalisation-plan.md §3; layout approved 2026-10-01 as the
 * "Budget vs Actual Plan" artifact, after the first cut was "not even I can
 * understand" — client 2026-10-01).
 *
 * Same two-view shape as Order Progress. Overview answers, in this order:
 *   1. Did finished orders make the money?      (KPI tiles)
 *   2. How did planned become actual?           (profit bridge)
 *   3. Which cost ran over?                     (spent against plan)
 *   4. Which order / customer / merchandiser missed most? (dumbbell)
 *   5. Which running order is heading for trouble?  (watch list)
 * Grey is always the plan, green better than plan, red worse, amber "watch".
 */

type View = "overview" | "orders";
const VIEWS = ["overview", "orders"] as const;
const GOOD = "var(--success)";
const BAD = "var(--danger)";
const WARN = "var(--warning)";
const PLAN = "color-mix(in srgb, var(--muted-foreground) 32%, transparent)";

export function BvaScreen({ rows }: { rows: ProfitOrderRow[] }) {
  const router = useRouter();
  const items = useMemo(() => rows.map(toBvaItem), [rows]);
  const [view, setView] = usePref<View>("budget-vs-actual:view", VIEWS, "overview");
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState("");
  const [merch, setMerch] = useState("");
  const [stage, setStage] = useState<"all" | BvaStage>("all");

  const customers = useMemo(() => [...new Set(items.map((i) => i.row.customer).filter((v): v is string => !!v))].sort(), [items]);
  const merchants = useMemo(() => [...new Set(items.map((i) => i.row.merchandiser).filter((v): v is string => !!v))].sort(), [items]);
  const needle = q.trim().toLowerCase();
  const scoped = items.filter(
    (i) =>
      (!needle || (i.row.reNo?.toLowerCase().includes(needle) ?? false)) &&
      (!customer || i.row.customer === customer) &&
      (!merch || i.row.merchandiser === merch),
  );
  const open = (i: BvaItem) => router.push(`/orders/profit-check/${i.row.salesOrderId}`);
  const toList = (patch: { stage?: "all" | BvaStage; customer?: string; merch?: string }) => {
    if (patch.stage) setStage(patch.stage);
    if (patch.customer !== undefined) setCustomer(patch.customer);
    if (patch.merch !== undefined) setMerch(patch.merch);
    setView("orders");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order Profit Check"
        back={false}
        description="Are our orders making the money we planned? The budget the MD approved, beside what has really been spent and shipped."
        actions={
          <ToggleGroup
            role="tablist"
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "overview", label: "Overview" },
              { value: "orders", label: "Orders", count: scoped.length },
            ]}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {/* caps-input: exempt -- a search box filters, it never stores a value */}
        <Input type="search" uppercase={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search RE No" aria-label="Search RE No" className="w-52 max-sm:w-full" />
        <Select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer" className="w-52 max-sm:w-full">
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={merch} onChange={(e) => setMerch(e.target.value)} aria-label="Merchandiser" className="w-52 max-sm:w-full">
          <option value="">All merchandisers</option>
          {merchants.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-3.5 text-xs text-muted-foreground">
          <Key color={PLAN} label="Plan" />
          <Key color={GOOD} label="Better than plan" />
          <Key color={BAD} label="Worse than plan" />
        </div>
      </div>

      {view === "overview" ? (
        <Overview items={scoped} open={open} toList={toList} />
      ) : (
        <OrdersList items={scoped} stage={stage} setStage={setStage} open={open} />
      )}
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="size-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

type Tip = { x: number; y: number; body: ReactNode } | null;

function GlassCard({ title, hint, right, className, children }: { title: string; hint?: string; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2 rounded-2xl px-4 py-3.5", className)} style={{ background: "var(--glass-row)", border: "1px solid var(--glass-edge)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</h3>
        {right ?? (hint && <span className="text-xs text-muted-foreground/80">{hint}</span>)}
      </div>
      {children}
    </section>
  );
}

function Overview({ items, open, toList }: { items: BvaItem[]; open: (i: BvaItem) => void; toList: (p: { stage?: "all" | BvaStage; customer?: string; merch?: string }) => void }) {
  const [tip, setTip] = useState<Tip>(null);
  const live = items.filter((i) => i.stage !== "cancelled");
  const done = live.filter(isComparable);
  const running = live.filter((i) => i.stage === "run").length;
  const br = bridge(live);
  const mt = meters(live);
  const watch = watchList(live);
  const plannedAll = live.reduce((a, i) => a + (i.planProfit ?? 0), 0);

  // COMPACT BY DEFAULT (client 2026-10-01: "compacted design"): a card is shown
  // only when it has something to say. Before any order buys or ships, the one
  // thing worth a chart is the plan itself — profit and margin per order.
  return (
    <div className="relative isolate overflow-hidden rounded-[22px]" style={{ background: "var(--glass-ground)" }}>
      <span aria-hidden className="pointer-events-none absolute -left-16 -top-10 size-72 rounded-full blur-[44px]" style={{ background: "var(--glass-blob-a)" }} />
      <span aria-hidden className="pointer-events-none absolute -right-10 top-8 size-64 rounded-full blur-[44px]" style={{ background: "var(--glass-blob-b)" }} />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-80 rounded-full blur-[48px]" style={{ background: "var(--glass-blob-c)" }} />
      <div
        className="relative m-2.5 grid gap-3 rounded-[18px] p-3.5 backdrop-blur-[22px] backdrop-saturate-[1.7] lg:grid-cols-3"
        style={{ background: "var(--glass)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-shadow)" }}
      >
        <Kpis done={done} live={live} plannedAll={plannedAll} running={running} />

        {br && (
          <GlassCard title="From planned to actual profit" hint="Finished orders · what moved the money" className="lg:col-span-2">
            <Bridge br={br} setTip={setTip} onStep={() => toList({ stage: "done" })} />
          </GlassCard>
        )}
        {mt.length > 0 && (
          <GlassCard title="Spent against plan" hint="Finished orders">
            <Meters rows={mt} />
          </GlassCard>
        )}
        {done.length > 0 ? (
          <GlassCard title="Furthest from plan" className="lg:col-span-2" right={null}>
            <Furthest done={done} open={open} toList={toList} setTip={setTip} />
          </GlassCard>
        ) : (
          <GlassCard title="Planned profit by order" hint="The approved budgets" className={running ? "lg:col-span-2" : "lg:col-span-3"}>
            <PlannedBars live={live} open={open} />
          </GlassCard>
        )}
        {(running > 0 || done.length > 0) && (
          <GlassCard title="Watch: running orders" hint="Spending faster than shipping">
            <Watch watch={watch} running={running} open={open} />
          </GlassCard>
        )}
        {done.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground lg:col-span-3">
            {running
              ? "The profit bridge and spend-against-plan charts appear once an order is finished (Order Closure ▸ Completion)."
              : "Once orders start buying and shipping, this page adds a watch list; once one is finished, the profit bridge and spend against plan."}
          </p>
        )}
      </div>
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 min-w-44 max-w-64 rounded-xl px-3 py-2.5 text-xs backdrop-blur-md"
          style={{ left: tip.x + 14, top: tip.y + 14, background: "var(--glass-strong)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-shadow)" }}
        >
          {tip.body}
        </div>
      )}
    </div>
  );
}

/** Before anything ships: the plan itself. Planned profit as a bar, margin against the approval chart's 15% target. */
function PlannedBars({ live, open }: { live: BvaItem[]; open: (i: BvaItem) => void }) {
  const rows = live.filter((i) => i.planProfit != null).sort((a, b) => (b.planProfit ?? 0) - (a.planProfit ?? 0)).slice(0, 10);
  if (!rows.length) return <Empty>No order has a complete approved budget yet.</Empty>;
  const max = Math.max(1, ...rows.map((i) => i.planProfit ?? 0));
  const low = rows.filter((i) => (i.planMargin ?? 0) < MARGIN_TARGET_PCT).length;
  return (
    <>
      <p className="text-[13.5px]">
        {low ? (
          <>
            <b style={{ color: WARN }}>{low}</b> of {rows.length} orders are planned below the {MARGIN_TARGET_PCT}% margin target.
          </>
        ) : (
          <>Every order is planned at or above the {MARGIN_TARGET_PCT}% margin target.</>
        )}
      </p>
      <div className="flex flex-col">
        {rows.map((i) => {
          const m = i.planMargin ?? 0;
          const c = m >= MARGIN_TARGET_PCT ? GOOD : m >= MARGIN_TARGET_PCT - 5 ? WARN : BAD;
          return (
            <button
              key={i.row.salesOrderId}
              type="button"
              onClick={() => open(i)}
              className="grid grid-cols-[12.5rem_minmax(0,1fr)_7rem_4.5rem] items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--glass-strong)] max-sm:grid-cols-[minmax(0,1fr)_6rem_4rem]"
            >
              <span className="min-w-0">
                <span className="block font-mono text-xs font-medium">{i.row.reNo}</span>
                <Truncated text={i.row.customer ?? ""} className="block text-[11.5px] text-muted-foreground" />
              </span>
              <span className="h-2.5 overflow-hidden rounded-full max-sm:hidden" style={{ background: "var(--glass-track)" }}>
                <i className="block h-full rounded-full" style={{ width: `${((i.planProfit ?? 0) / max) * 100}%`, background: "var(--primary)" }} />
              </span>
              <span className="text-right font-semibold tabular-nums">{rupees(i.planProfit ?? 0)}</span>
              <span className="text-right">
                <span className="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>
                  {m.toFixed(1)}%
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="my-auto py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function Kpis({ done, live, plannedAll, running }: { done: (BvaItem & { planProfit: number; profit: number; gap: number })[]; live: BvaItem[]; plannedAll: number; running: number }) {
  const tile = "flex min-w-0 flex-col gap-0.5 rounded-2xl px-4 py-3";
  const glass = { background: "var(--glass-strong)", border: "1px solid var(--glass-edge)" };
  const label = "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  if (!done.length) {
    const ps = live.reduce((a, i) => a + (i.planSales ?? 0), 0);
    return (
      <div className="grid gap-3 sm:grid-cols-3 lg:col-span-3">
        <div className={tile} style={glass}>
          <span className={label}>Planned profit</span>
          <span className="text-[1.75rem] font-bold tabular-nums tracking-tight">{lakh(plannedAll)}</span>
          <span className="text-xs text-muted-foreground">across {live.length} orders with an approved budget</span>
        </div>
        <div className={tile} style={glass}>
          <span className={label}>Planned margin</span>
          <span className="text-[1.75rem] font-bold tabular-nums tracking-tight">{ps ? `${((plannedAll / ps) * 100).toFixed(1)}%` : "—"}</span>
          <span className="text-xs text-muted-foreground">{running ? `${running} running · ` : ""}target {MARGIN_TARGET_PCT}%</span>
        </div>
        <div className={tile} style={glass}>
          <span className={label}>Actual profit</span>
          <span className="text-[1.75rem] font-bold tracking-tight text-muted-foreground">—</span>
          <span className="text-xs text-muted-foreground">known once an order is finished (Order Closure ▸ Completion)</span>
        </div>
      </div>
    );
  }
  const plan = done.reduce((a, i) => a + i.planProfit, 0);
  const got = done.reduce((a, i) => a + i.profit, 0);
  const ps = done.reduce((a, i) => a + (i.planSales ?? 0), 0);
  const ss = done.reduce((a, i) => a + (i.sales ?? 0), 0);
  const pm = ps ? (plan / ps) * 100 : 0;
  const am = ss ? (got / ss) * 100 : 0;
  const below = done.filter((i) => i.gap < 0).length;
  const gap = got - plan;
  const tone = gap < 0 ? BAD : GOOD;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-4">
      <div className={tile} style={glass}>
        <span className={label}>Planned profit</span>
        <span className="text-[1.75rem] font-bold tabular-nums tracking-tight">{lakh(plan)}</span>
        <span className="text-xs text-muted-foreground">{done.length} finished orders</span>
      </div>
      <div className={tile} style={glass}>
        <span className={label}>Actual profit</span>
        <span className="text-[1.75rem] font-bold tabular-nums tracking-tight" style={{ color: tone }}>
          {lakh(got)}
        </span>
        <span className="text-xs text-muted-foreground">
          <b style={{ color: tone }}>
            {gap < 0 ? "▼" : "▲"} {lakh(Math.abs(gap))}
          </b>{" "}
          {gap < 0 ? "below" : "above"} plan
        </span>
      </div>
      <div className={tile} style={glass}>
        <span className={label}>Margin</span>
        <span className="flex items-baseline gap-2 text-[1.75rem] font-bold tabular-nums tracking-tight">
          <span className="text-muted-foreground">{pm.toFixed(1)}%</span>
          <span className="text-lg text-muted-foreground/70">→</span>
          <span style={{ color: am < pm ? BAD : GOOD }}>{am.toFixed(1)}%</span>
        </span>
        <span className="text-xs text-muted-foreground">planned → actual</span>
      </div>
      <div className={tile} style={glass}>
        <span className={label}>Below plan</span>
        <span className="text-[1.75rem] font-bold tabular-nums tracking-tight">
          {below} <span className="text-base font-semibold text-muted-foreground">of {done.length}</span>
        </span>
        <span className="mt-1.5 flex h-1.5 overflow-hidden rounded-full" style={{ background: "var(--glass-track)" }}>
          <i className="block h-full" style={{ width: `${((done.length - below) / done.length) * 100}%`, background: GOOD }} />
          <i className="block h-full" style={{ width: `${(below / done.length) * 100}%`, background: BAD }} />
        </span>
      </div>
    </div>
  );
}

function Bridge({ br, setTip, onStep }: { br: NonNullable<ReturnType<typeof bridge>>; setTip: (t: Tip) => void; onStep: () => void }) {
  type Bar = { label: string; value: number; total: boolean; from: number; to: number };
  // Running level before each step — a prefix sum, computed without mutating during render.
  const starts = br.steps.map((_, k) => br.plan + br.steps.slice(0, k).reduce((a, s) => a + s.value, 0));
  const bars: Bar[] = [
    { label: "Planned profit", value: br.plan, total: true, from: 0, to: br.plan },
    ...br.steps.map((s, k) => ({ label: s.label, value: s.value, total: false, from: starts[k], to: starts[k] + s.value })),
    { label: "Actual profit", value: br.actual, total: true, from: 0, to: br.actual },
  ];
  const levels = bars.filter((b) => !b.total).flatMap((b) => [b.from, b.to]).concat([br.plan, br.actual]);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const span = Math.max(1, hi - lo);
  // A scale from zero would flatten every step against ₹30 L totals; start
  // below the lowest level instead, and say so on the chart.
  const floor = Math.max(0, Math.floor((lo - span * 0.6) / 100000) * 100000);
  const top = Math.ceil((hi + span * 0.15) / 100000) * 100000 || hi * 1.1;
  const W = 760, H = 290, L = 50, R = 10, T = 28, B = 58;
  const slot = (W - L - R) / bars.length;
  const bw = Math.min(64, slot * 0.58);
  const Y = (v: number) => T + (1 - (v - floor) / Math.max(1, top - floor)) * (H - T - B);
  const X = (i: number) => L + slot * i + slot / 2;
  const worst = br.steps.reduce((a, s) => (s.value < a.value ? s : a), br.steps[0]);
  const gridVals = [0, 1, 2, 3, 4].map((t) => floor + ((top - floor) / 4) * t);

  return (
    <>
      <p className="text-[13.5px]">
        Planned <b>{lakh(br.plan)}</b>, made <b style={{ color: br.actual < br.plan ? BAD : GOOD }}>{lakh(br.actual)}</b>.
        {worst && worst.value < 0 && (
          <>
            {" "}
            The biggest loss is <b style={{ color: BAD }}>{worst.label.toLowerCase()}</b> ({lakh(worst.value)}).
          </>
        )}
        {br.provisional > 0 && <span className="text-muted-foreground"> {br.provisional} order(s) still miss a cost, so their profit is provisional.</span>}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label="Profit bridge from planned to actual">
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--glass-track)" strokeDasharray="3 4" />
            <text x={L - 8} y={Y(v) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--muted-foreground)">
              {lakh(v).replace("₹", "")}
            </text>
          </g>
        ))}
        {floor > 0 && (
          <text x={W - R} y={12} textAnchor="end" fontSize={10.5} fill="var(--muted-foreground)">
            Scale starts at {lakh(floor)}, not zero
          </text>
        )}
        {bars.map((b, i) => {
          const y1 = b.total ? Y(b.value) : Y(Math.max(b.from, b.to));
          const y2 = b.total ? Y(floor) : Y(Math.min(b.from, b.to));
          const h = Math.max(2, y2 - y1);
          const c = b.total ? (i === 0 ? PLAN : br.actual < br.plan ? BAD : GOOD) : b.value < 0 ? BAD : GOOD;
          const x = X(i) - bw / 2;
          const nextTop = b.total ? Y(b.value) : Y(b.to);
          const words = b.label.split(" ");
          const l1 = b.label.length > 12 && words.length > 1 ? words.slice(0, Math.ceil(words.length / 2)).join(" ") : b.label;
          const l2 = l1 === b.label ? "" : words.slice(Math.ceil(words.length / 2)).join(" ");
          return (
            <g
              key={i}
              className={cn(!b.total && "cursor-pointer")}
              onPointerMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  body: (
                    <>
                      <p className="mb-1 font-bold">{b.label}</p>
                      <p className="flex justify-between gap-3">
                        {b.total ? "Total" : b.value < 0 ? "Cost profit" : "Added to profit"}
                        <b className="tabular-nums" style={{ color: b.total ? undefined : b.value < 0 ? BAD : GOOD }}>
                          {rupees(b.value)}
                        </b>
                      </p>
                      {!b.total && <p className="mt-1 text-muted-foreground">Click to see the finished orders</p>}
                    </>
                  ),
                })
              }
              onPointerLeave={() => setTip(null)}
              onClick={b.total ? undefined : onStep}
            >
              {i < bars.length - 1 && <line x1={x + bw} x2={X(i + 1) - bw / 2} y1={nextTop} y2={nextTop} stroke="var(--muted-foreground)" strokeDasharray="3 3" opacity={0.6} />}
              <rect x={x} y={y1} width={bw} height={h} rx={6} fill={c} opacity={b.total ? 1 : 0.92} />
              {b.total && floor > 0 && (
                <path d={`M ${x - 2} ${y2 - 10} l ${bw / 4 + 1} -5 l ${bw / 4} 5 l ${bw / 4} -5 l ${bw / 4 + 1} 5`} fill="none" stroke="var(--surface)" strokeWidth={3} />
              )}
              <text x={X(i)} y={y1 - 8} textAnchor="middle" fontSize={b.total ? 14 : 12.5} fontWeight={700} fill={b.total ? "var(--foreground)" : c} className="tabular-nums">
                {b.total ? lakh(b.value) : `${b.value < 0 ? "−" : "+"}${lakh(Math.abs(b.value))}`}
              </text>
              <text x={X(i)} y={H - B + 18} textAnchor="middle" fontSize={12} fontWeight={b.total ? 700 : 400} fill={b.total ? "var(--foreground)" : "var(--muted-foreground)"}>
                {l1}
              </text>
              {l2 && (
                <text x={X(i)} y={H - B + 33} textAnchor="middle" fontSize={12} fontWeight={b.total ? 700 : 400} fill={b.total ? "var(--foreground)" : "var(--muted-foreground)"}>
                  {l2}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </>
  );
}

function Meters({ rows }: { rows: ReturnType<typeof meters> }) {
  const MAXP = 125;
  const over = rows.filter((r) => r.kind === "cost" && r.plan && r.actual / r.plan > 1.005).length;
  return (
    <>
      <p className="text-[13.5px]">
        {over ? (
          <>
            <b style={{ color: BAD }}>{over}</b> of 4 cost types went over plan.
          </>
        ) : (
          "Every cost type stayed within plan."
        )}
      </p>
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const pct = r.plan ? (r.actual / r.plan) * 100 : 0;
          const bad = r.kind === "cost" ? pct > 105 : pct < 95;
          const warn = r.kind === "cost" ? pct > 100 : pct < 100;
          const c = bad ? BAD : warn ? WARN : GOOD;
          const diff = r.actual - r.plan;
          return (
            <div key={r.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between text-[13px]">
                <b className="font-semibold">{r.label}</b>
                <span className="font-bold tabular-nums" style={{ color: c }}>
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="relative h-2.5 rounded-full" style={{ background: "var(--glass-track)" }}>
                <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (pct / MAXP) * 100)}%`, background: c }} />
                <span className="absolute -inset-y-[3px] w-0.5 rounded bg-foreground" style={{ left: `${(100 / MAXP) * 100}%` }} />
              </div>
              <span className="text-[11.5px] text-muted-foreground">
                {r.kind === "cost"
                  ? `${lakh(Math.abs(diff))} ${diff > 0 ? "over" : "under"} plan`
                  : diff < 0
                    ? `${lakh(Math.abs(diff))} short of plan`
                    : `${lakh(diff)} above plan`}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Furthest({
  done,
  open,
  toList,
  setTip,
}: {
  done: (BvaItem & { planProfit: number; profit: number; gap: number })[];
  open: (i: BvaItem) => void;
  toList: (p: { customer?: string; merch?: string }) => void;
  setTip: (t: Tip) => void;
}) {
  const [by, setBy] = useState<"order" | "customer" | "merch">("order");
  type Pt = { key: string; sub: string; plan: number; act: number; gap: number; item?: BvaItem };
  let pts: Pt[];
  if (by === "order") {
    pts = done.filter((i) => i.planMargin != null && i.margin != null).map((i) => ({ key: i.row.reNo ?? "—", sub: i.row.customer ?? "", plan: i.planMargin!, act: i.margin!, gap: i.gap, item: i }));
  } else {
    const M = new Map<string, { pp: number; ps: number; ap: number; as: number; gap: number; n: number }>();
    for (const i of done) {
      const k = (by === "customer" ? i.row.customer : i.row.merchandiser) ?? "—";
      const g = M.get(k) ?? { pp: 0, ps: 0, ap: 0, as: 0, gap: 0, n: 0 };
      g.pp += i.planProfit;
      g.ps += i.planSales ?? 0;
      g.ap += i.profit;
      g.as += i.sales ?? 0;
      g.gap += i.gap;
      g.n += 1;
      M.set(k, g);
    }
    pts = [...M.entries()].filter(([, g]) => g.ps && g.as).map(([k, g]) => ({ key: k, sub: `${g.n} finished orders`, plan: (g.pp / g.ps) * 100, act: (g.ap / g.as) * 100, gap: g.gap }));
  }
  pts = pts.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 8);
  const all = pts.flatMap((p) => [p.plan, p.act]);
  const lo = Math.floor(Math.min(...all, 0) / 5) * 5 - 2;
  const hi = Math.ceil(Math.max(...all, 5) / 5) * 5 + 2;
  const X = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / 5) * 5; t <= hi; t += 5) ticks.push(t);
  const worst = pts.find((p) => p.gap < 0);

  return (
    <>
      <div className="-mt-8 flex justify-end">
        <ToggleGroup
          label="Show"
          value={by}
          onChange={setBy}
          options={[
            { value: "order", label: "Orders" },
            { value: "customer", label: "Customers" },
            { value: "merch", label: "Merchandisers" },
          ]}
        />
      </div>
      <p className="text-[13.5px]">
        {worst ? (
          <>
            <b>{worst.key}</b> is furthest below plan: margin <b>{worst.plan.toFixed(1)}%</b> planned, <b style={{ color: BAD }}>{worst.act.toFixed(1)}%</b> made, {lakh(Math.abs(worst.gap))} less.
          </>
        ) : (
          "Every finished order met its plan."
        )}
      </p>
      <div className="grid grid-cols-[12.5rem_minmax(0,1fr)_7rem] gap-3 px-1.5 text-[11px] text-muted-foreground">
        <span />
        <span className="relative h-3.5">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${X(t)}%` }}>
              {t}%
            </span>
          ))}
        </span>
        <span className="text-right">vs plan</span>
      </div>
      <div className="flex flex-col">
        {pts.map((p) => {
          const c = p.act >= p.plan ? GOOD : BAD;
          const a = Math.min(X(p.plan), X(p.act));
          const b = Math.max(X(p.plan), X(p.act));
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => (p.item ? open(p.item) : by === "customer" ? toList({ customer: p.key }) : toList({ merch: p.key }))}
              onPointerMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  body: (
                    <>
                      <p className="mb-1 font-bold">{p.key}</p>
                      <p className="flex justify-between gap-3">Planned margin <b>{p.plan.toFixed(1)}%</b></p>
                      <p className="flex justify-between gap-3">Actual margin <b>{p.act.toFixed(1)}%</b></p>
                      <p className="flex justify-between gap-3">Profit vs plan <b style={{ color: c }}>{rupees(p.gap)}</b></p>
                    </>
                  ),
                })
              }
              onPointerLeave={() => setTip(null)}
              className="grid grid-cols-[12.5rem_minmax(0,1fr)_7rem] items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--glass-strong)]"
            >
              <span className="min-w-0">
                <Truncated text={p.key} className={cn("block", by === "order" ? "font-mono text-xs font-medium" : "font-semibold")} />
                <Truncated text={p.sub} className="block text-[11.5px] text-muted-foreground" />
              </span>
              <span className="relative h-5">
                <span className="absolute inset-x-0 top-[9px] border-t border-dashed" style={{ borderColor: "var(--glass-track)" }} />
                <span className="absolute top-2 h-1 rounded" style={{ left: `${a}%`, width: `${b - a}%`, background: c, opacity: 0.45 }} />
                <span className="absolute top-[3px] size-3.5 -translate-x-1/2 rounded-full border-2 border-surface" style={{ left: `${X(p.plan)}%`, background: PLAN }} />
                <span className="absolute top-[3px] size-3.5 -translate-x-1/2 rounded-full border-2 border-surface" style={{ left: `${X(p.act)}%`, background: c, boxShadow: `0 0 8px ${c}` }} />
              </span>
              <span className="text-right font-bold tabular-nums" style={{ color: c }}>
                {p.gap >= 0 ? "+" : "−"}
                {lakh(Math.abs(p.gap))}
                <span className="block text-[11px] font-medium text-muted-foreground">
                  {p.act - p.plan >= 0 ? "+" : ""}
                  {(p.act - p.plan).toFixed(1)} pts margin
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3.5 text-[11.5px] text-muted-foreground">
        <Key color={PLAN} label="Planned margin" />
        <Key color={GOOD} label="Actual, better" />
        <Key color={BAD} label="Actual, worse" />
      </div>
    </>
  );
}

function Watch({ watch, running, open }: { watch: ReturnType<typeof watchList>; running: number; open: (i: BvaItem) => void }) {
  return (
    <>
      <p className="text-[13.5px]">
        {watch.length ? (
          <>
            <b>{watch.length}</b> running orders have spent much more than they have shipped.
          </>
        ) : running ? (
          "Running orders are spending in step with shipping."
        ) : (
          "No order is running yet — nothing bought or shipped."
        )}
      </p>
      <div className="flex flex-col gap-1.5">
        {watch.slice(0, 5).map(({ item: i, ahead }) => (
          <button
            key={i.row.salesOrderId}
            type="button"
            onClick={() => open(i)}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 rounded-xl px-2.5 py-2 text-left hover:ring-1 hover:ring-warning"
            style={{ background: "var(--glass-strong)", border: "1px solid var(--glass-edge)" }}
          >
            <span className="min-w-0">
              <span className="block font-mono text-xs font-medium">{i.row.reNo}</span>
              <Truncated text={i.row.customer ?? ""} className="block text-[11.5px] text-muted-foreground" />
            </span>
            <span className="text-right text-[11.5px] font-bold text-warning">{Math.round(ahead)} pts ahead</span>
            {[
              ["Spent", i.spendPct ?? 0, WARN],
              ["Shipped", i.shipPct ?? 0, "var(--info)"],
            ].map(([l, v, c]) => (
              <span key={l as string} className="col-span-2 grid grid-cols-[3.25rem_1fr_2.5rem] items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{l}</span>
                <span className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--glass-track)" }}>
                  <i className="block h-full rounded-full" style={{ width: `${Math.min(100, v as number)}%`, background: c as string }} />
                </span>
                <b className="text-right tabular-nums text-foreground">{Math.round(v as number)}%</b>
              </span>
            ))}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Orders list
// ---------------------------------------------------------------------------

const TONE: Record<ReturnType<typeof resultOf>["tone"], StatusTone> = { good: "success", bad: "danger", warn: "warning", info: "info", none: "neutral" };
const STAGES: ("all" | BvaStage)[] = ["all", "done", "run", "none", "cancelled"];

function OrdersList({ items, stage, setStage, open }: { items: BvaItem[]; stage: "all" | BvaStage; setStage: (s: "all" | BvaStage) => void; open: (i: BvaItem) => void }) {
  const [sort, setSort] = useState<"result" | "re">("result");
  const rank = (i: BvaItem) => (i.stage === "done" ? (i.gap ?? 0) : i.stage === "run" ? -((i.spendPct ?? 0) - (i.shipPct ?? 0)) * 1000 : i.stage === "none" ? 1e12 : 2e12);
  const list = items
    .filter((i) => stage === "all" || i.stage === stage)
    .sort(sort === "re" ? (a, b) => (a.row.reNo ?? "").localeCompare(b.row.reNo ?? "") : (a, b) => rank(a) - rank(b));
  const pg = usePagination(list);

  return (
    <div className="space-y-3">
      {/* Scrolls rather than clips on a phone (2026-10-03): five stages do not
          fit 390px and "Cancelled" was cut off at the edge. */}
      <ToggleGroup
        label="Stage"
        value={stage}
        onChange={setStage}
        options={STAGES.map((s) => ({
          value: s,
          label: s === "all" ? "All" : STAGE_LABEL[s],
          count: items.filter((i) => s === "all" || i.stage === s).length,
        }))}
      />
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {items.length ? "No orders at this stage." : "No order has an approved budget yet. Orders appear here once the MD approves a budget."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[62rem] text-[13px]">
              <thead>
                <tr className="bg-surface-muted text-left text-xs text-muted-foreground">
                  <th className="h-9 px-3 font-medium">
                    <button type="button" onClick={() => setSort("re")} className={cn("hover:text-foreground", sort === "re" && "text-foreground")}>
                      RE No{sort === "re" ? " ↓" : ""}
                    </button>
                  </th>
                  <th className="h-9 px-3 font-medium">Customer</th>
                  <th className="h-9 px-3 font-medium">Stage</th>
                  <th className="h-9 px-3 text-right font-medium">Pieces shipped</th>
                  <th className="h-9 px-3 text-right font-medium">Planned profit</th>
                  <th className="h-9 px-3 text-right font-medium">Profit so far</th>
                  <th className="h-9 px-3 font-medium">
                    <button type="button" onClick={() => setSort("result")} className={cn("hover:text-foreground", sort === "result" && "text-foreground")}>
                      Result{sort === "result" ? " ↓" : ""}
                    </button>
                  </th>
                  <th className="h-9 px-3 font-medium">Money spent</th>
                  <th className="h-9 px-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {pg.paged.map((i) => {
                  const r = resultOf(i);
                  return (
                    <tr
                      key={i.row.salesOrderId}
                      tabIndex={0}
                      onClick={() => open(i)}
                      onKeyDown={(e) => e.key === "Enter" && open(i)}
                      className="cursor-pointer border-t border-border hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                    >
                      <td className="h-11 whitespace-nowrap px-3 font-mono text-xs font-medium text-primary">{i.row.reNo ?? "—"}</td>
                      <td className="max-w-[15rem] px-3">
                        <Truncated text={i.row.customer ?? "—"} />
                        <Truncated text={i.row.merchandiser ?? ""} className="block text-xs text-muted-foreground" />
                      </td>
                      <td className="whitespace-nowrap px-3">{STAGE_LABEL[i.stage]}</td>
                      <td className="whitespace-nowrap px-3 text-right tabular-nums">
                        {fmtNumber(i.row.shippedQty)} <span className="text-xs text-muted-foreground">/ {fmtNumber(i.row.orderQty)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 text-right tabular-nums">{i.planProfit != null ? rupees(i.planProfit) : <span className="text-xs text-muted-foreground">Budget incomplete</span>}</td>
                      <td className="whitespace-nowrap px-3 text-right tabular-nums">
                        {i.profit != null ? <b style={{ color: (i.gap ?? 0) < 0 ? BAD : GOOD }}>{rupees(i.profit)}</b> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3">
                        <span className="inline-flex items-center gap-2">
                          <StatusPill tone={TONE[r.tone]}>{r.label}</StatusPill>
                          <span className="text-xs text-muted-foreground">{r.detail}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3">
                        {i.spendPct != null ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted">
                              <i className="block h-full" style={{ width: `${Math.min(100, i.spendPct)}%`, background: i.spendPct > 100 ? BAD : WARN }} />
                            </span>
                            <span className="text-xs text-muted-foreground">{Math.round(i.spendPct)}% of plan</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 text-xs text-muted-foreground">{fmtDate(i.row.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationBar page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />
        </>
      )}
    </div>
  );
}
