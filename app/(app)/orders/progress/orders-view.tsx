"use client";

import { Fragment, useEffect, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { ChevronRight, Download, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber } from "@/lib/format";
import { daysBetween } from "@/lib/calendar";
import { usePagination } from "@/lib/use-pagination";
import {
  BUCKET_COLOR,
  GROUP_ORDER,
  byUrgency,
  holdingText,
  weekStart,
  type Bucket,
  type ProgressItem,
} from "@/lib/orders/progress/view";
import { RISK_LABELS, STAGE_GROUP_LABELS, type ProgressStage } from "@/lib/orders/progress/engine";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { PaginationBar } from "@/components/ui/pagination";
import { Truncated } from "@/components/ui/truncated";
import type { ListFilters, Segment } from "./progress-screen";

/**
 * Order Progress ▸ Orders — the working list. One calm line per order (who,
 * how many, when, status); the stage detail opens inside the row.
 */

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "open", label: "Open orders" },
  { key: "late", label: "Late" },
  { key: "risk", label: "At risk" },
  { key: "ok", label: "On track" },
  { key: "none", label: "No T&A plan" },
  { key: "done", label: "Shipped / closed" },
];

const PILL_TONE = { late: "danger", risk: "warning", ok: "success", none: "neutral", done: "info" } as const;

const inSegment = (i: ProgressItem, s: Segment) => (s === "open" ? i.bucket !== "done" : i.bucket === s);

export function OrdersView({
  items,
  today,
  filters: f,
  setFilters,
  scopeChips,
  clearScope,
}: {
  items: ProgressItem[];
  today: string;
  filters: ListFilters;
  setFilters: Dispatch<SetStateAction<ListFilters>>;
  scopeChips: { key: string; label: string; clear: () => void }[];
  clearScope: () => void;
}) {
  const set = (patch: Partial<ListFilters>) => setFilters((x) => ({ ...x, ...patch }));
  const stageLabels = items[0]?.row.progress.stages.map((s) => s.label) ?? [];

  const sorted = items
    .filter(
      (i) =>
        inSegment(i, f.segment) &&
        (f.week == null || i.week === f.week) &&
        (f.stage == null || (i.cur === f.stage && i.bucket !== "done")),
    )
    .sort(
      f.sort === "urgent"
        ? byUrgency
        : f.sort === "due"
          ? (a, b) => (a.row.deliveryDate ?? "9999").localeCompare(b.row.deliveryDate ?? "9999")
          : (a, b) => (a.row.orderNumber ?? "").localeCompare(b.row.orderNumber ?? ""),
    );
  const groupKey = (i: ProgressItem) =>
    f.group === "customer"
      ? (i.row.customer ?? "No customer")
      : f.group === "merchandiser"
        ? (i.row.merchandiser ?? "No merchandiser")
        : f.group === "month"
          ? i.row.deliveryDate
            ? new Date(`${i.row.deliveryDate}T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
            : "No delivery date"
          : "";
  const list = f.group ? [...sorted].sort((a, b) => groupKey(a).localeCompare(groupKey(b))) : sorted;
  const pg = usePagination(list);
  const { setPage, pageSize } = pg;

  // An order opened from a chart lands on its own page of the list.
  useEffect(() => {
    if (!f.open) return;
    const idx = list.findIndex((i) => i.row.salesOrderId === f.open);
    if (idx >= 0) setPage(Math.floor(idx / pageSize) + 1);
    // Only when the target changes — paging on afterwards is the operator's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.open]);

  const counts = Object.fromEntries(SEGMENTS.map((s) => [s.key, items.filter((i) => inSegment(i, s.key)).length]));

  const listChips = [
    ...(f.week != null
      ? [{ key: "week", label: f.week === 0 ? "Past delivery" : f.week > 13 ? "After 13 weeks" : `Delivery week of ${fmtDate(weekStart(today, f.week))}`, clear: () => set({ week: null }) }]
      : []),
    ...(f.stage != null ? [{ key: "stage", label: `Now at ${stageLabels[f.stage] ?? "stage"}`, clear: () => set({ stage: null }) }] : []),
    ...scopeChips,
  ];

  const download = () => {
    const head = ["RE No", "Customer", "Merchandiser", "Order Qty", "Delivery", "Days", "Shipped Qty", "Status", "Holding it up"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = list.map((i) =>
      [
        i.row.orderNumber,
        i.row.customer,
        i.row.merchandiser,
        i.qty,
        fmtDate(i.row.deliveryDate),
        i.days == null ? "" : i.days,
        i.shipped,
        RISK_LABELS[i.row.progress.risk.level],
        holdingText(i),
      ]
        .map(esc)
        .join(","),
    );
    const blob = new Blob([[head.map(esc).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `order-progress-${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Which rows open a group — worked out before render, not by mutating during it.
  const heads = new Set<string>();
  if (f.group) {
    let prev: string | null = null;
    for (const i of pg.paged) {
      const g = groupKey(i);
      if (g !== prev) heads.add(i.row.salesOrderId);
      prev = g;
    }
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={f.segment === s.key}
            onClick={() => set({ segment: s.key, open: null })}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium",
              f.segment === s.key ? "border-primary bg-primary-soft text-foreground" : "border-border bg-surface text-muted-foreground hover:border-border-strong",
            )}
          >
            {s.key !== "open" && <i className="size-2 rounded-full" style={{ background: BUCKET_COLOR[s.key as Bucket] }} />}
            {s.label}
            <b className="font-semibold tabular-nums text-foreground">{fmtNumber(counts[s.key])}</b>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Select value={f.group} onChange={(e) => set({ group: e.target.value as ListFilters["group"] })} aria-label="Group by" className="w-44">
            <option value="">No grouping</option>
            <option value="customer">Group by customer</option>
            <option value="merchandiser">Group by merchandiser</option>
            <option value="month">Group by delivery month</option>
          </Select>
          <Select value={f.sort} onChange={(e) => set({ sort: e.target.value as ListFilters["sort"] })} aria-label="Sort" className="w-44">
            <option value="urgent">Most urgent first</option>
            <option value="due">Delivery date</option>
            <option value="re">RE No</option>
          </Select>
          <Button type="button" variant="outline" onClick={download} disabled={!list.length}>
            <Download className="size-4" /> Download
          </Button>
        </div>
      </div>

      {listChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Filtered by
          {listChips.map((c) => (
            <button key={c.key} type="button" onClick={c.clear} className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary-soft py-0.5 pl-2.5 pr-1.5 text-xs text-foreground">
              {c.label} <X className="size-3 text-muted-foreground" aria-label="Remove" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              set({ week: null, stage: null });
              clearScope();
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-2.5 pr-1.5 text-xs"
          >
            Clear all <X className="size-3 text-muted-foreground" />
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No orders match these filters. {items.length} in total.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="bg-surface-muted text-left text-xs text-muted-foreground">
                  <th className="h-9 w-8 border-b border-border" />
                  {[
                    ["re", "RE No", ""],
                    ["", "Customer", ""],
                    ["", "Merchandiser", ""],
                    ["", "Qty", "text-right"],
                    ["due", "Delivery", ""],
                    ["urgent", "Days", "text-right"],
                    ["", "Shipped", ""],
                    ["", "Status", ""],
                  ].map(([k, label, cls]) => (
                    <th key={label} className={cn("h-9 whitespace-nowrap border-b border-border px-2.5 font-medium", cls)}>
                      {k ? (
                        <button type="button" onClick={() => set({ sort: k as ListFilters["sort"] })} className={cn("hover:text-foreground", f.sort === k && "text-foreground")}>
                          {label}
                          {f.sort === k ? " ↓" : ""}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pg.paged.map((i) => {
                  const g = f.group ? groupKey(i) : null;
                  const head = g != null && heads.has(i.row.salesOrderId);
                  const open = f.open === i.row.salesOrderId;
                  const sp = i.qty ? Math.round((i.shipped / i.qty) * 100) : 0;
                  return (
                    <Fragment key={i.row.salesOrderId}>
                      {head && <GroupRow label={g!} members={list.filter((x) => groupKey(x) === g)} />}
                      <tr
                        tabIndex={0}
                        aria-expanded={open}
                        onClick={() => set({ open: open ? null : i.row.salesOrderId })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            set({ open: open ? null : i.row.salesOrderId });
                          }
                        }}
                        className={cn("group cursor-pointer [&>td]:h-10 [&>td]:border-t [&>td]:border-border [&>td]:px-2.5 hover:[&>td]:bg-surface-muted", open && "[&>td]:bg-surface-muted")}
                      >
                        <td
                          className="!pl-2.5 !pr-0"
                          style={i.bucket === "late" || i.bucket === "risk" ? { boxShadow: `inset 3px 0 0 ${BUCKET_COLOR[i.bucket]}` } : undefined}
                        >
                          <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
                        </td>
                        <td className="whitespace-nowrap font-mono text-xs font-medium">{i.row.orderNumber ?? i.row.amendmentCode}</td>
                        <td className="max-w-[14rem]">
                          <Truncated text={i.row.customer ?? "—"} />
                        </td>
                        <td className="whitespace-nowrap text-muted-foreground">{i.row.merchandiser ?? "—"}</td>
                        <td className="text-right tabular-nums">{fmtNumber(i.row.orderQty)}</td>
                        <td className="whitespace-nowrap tabular-nums">{fmtDate(i.row.deliveryDate)}</td>
                        <td className="text-right tabular-nums">
                          <DaysCell item={i} />
                        </td>
                        <td className="w-28 whitespace-nowrap">
                          <span className="mr-1.5 inline-block h-1.5 w-12 overflow-hidden rounded-full bg-surface-muted align-middle">
                            <i className="block h-full bg-info" style={{ width: `${sp}%` }} />
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">{sp}%</span>
                        </td>
                        <td>
                          <StatusPill tone={PILL_TONE[i.bucket]}>{RISK_LABELS[i.row.progress.risk.level]}</StatusPill>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={9} className="border-t border-border bg-surface-muted p-0">
                            <Board item={i} today={today} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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

function DaysCell({ item: i }: { item: ProgressItem }) {
  if (i.bucket === "done" || i.days == null) return <span className="text-muted-foreground">—</span>;
  if (i.days < 0) return <span className="font-semibold text-danger">{-i.days}d late</span>;
  if (i.days === 0) return <span className="font-semibold text-warning">today</span>;
  return <span className={cn(i.days <= 14 ? "font-semibold text-foreground" : "text-muted-foreground")}>{i.days}d</span>;
}

function GroupRow({ label, members }: { label: string; members: ProgressItem[] }) {
  const n = members.length;
  const c = (b: Bucket) => members.filter((m) => m.bucket === b).length;
  return (
    <tr>
      <td colSpan={9} className="h-8 border-t border-border bg-surface-muted px-2.5 text-xs font-semibold">
        {label}
        <span className="mx-2 inline-flex h-1.5 w-28 overflow-hidden rounded-full bg-border align-middle">
          {(["late", "risk", "ok", "none", "done"] as const).map((b) =>
            c(b) ? <i key={b} className="block h-full" style={{ width: `${(c(b) / n) * 100}%`, background: BUCKET_COLOR[b] }} /> : null,
          )}
        </span>
        <span className="font-normal text-muted-foreground">
          {n} orders{c("late") ? ` · ${c("late")} late` : ""}
          {c("risk") ? ` · ${c("risk")} at risk` : ""}
        </span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// The opened row: stage journey · three cards · full schedule
// ---------------------------------------------------------------------------

const DOT: Record<string, string> = {
  done: "var(--success)",
  done_late: "var(--success)",
  in_progress: "var(--info)",
  overdue: "var(--danger)",
  pending: "var(--border)",
};

function Delta({ s }: { s: ProgressStage }) {
  if (s.view.state === "done") return <span className="rounded bg-success-soft px-1 text-[10px] font-semibold text-success">on time</span>;
  if (s.view.state === "done_late" || s.view.state === "overdue")
    return <span className="rounded bg-danger-soft px-1 text-[10px] font-semibold tabular-nums text-danger">+{s.view.daysLate}d</span>;
  return null;
}

function Board({ item: i, today }: { item: ProgressItem; today: string }) {
  const stages = i.row.progress.stages;
  const risk = i.row.progress.risk;
  const doneN = stages.filter((s) => s.view.state === "done" || s.view.state === "done_late").length;
  const reach = i.cur < 0 ? stages.length : i.cur + 0.5;
  const hold = i.cur >= 0 ? stages[i.cur] : null;
  const flow = ["CUT", "SEW", "PACK", "SHIP"].map((k) => stages.find((s) => s.key === k)).filter((s): s is ProgressStage => !!s);
  const left = i.days;

  return (
    <div className="space-y-3 px-4 pb-4 pt-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          Order qty <b className="tabular-nums text-foreground">{fmtNumber(i.row.orderQty)}</b>
        </span>
        <span>
          Shipped <b className="tabular-nums text-foreground">{fmtNumber(i.shipped)}</b>
        </span>
        <span>
          Merchandiser <b className="text-foreground">{i.row.merchandiser ?? "—"}</b>
        </span>
        {i.row.alert && (
          <span className="text-warning">
            Alert sent {fmtDate(i.row.alert.notifiedAt)} to the merchandiser and MD
          </span>
        )}
        <Link href={`/orders/garment-orders?open=${i.row.amendmentId}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          Open order <ExternalLink className="size-3" />
        </Link>
      </div>

      {/* 1. Stage journey */}
      <div className="rounded-lg border border-border bg-surface px-3.5 pb-2 pt-2.5">
        <div className="mb-2.5 flex items-baseline justify-between text-xs font-semibold">
          Stage journey <span className="font-normal text-muted-foreground">{doneN} of {stages.length} stages done</span>
        </div>
        <div className="overflow-x-auto">
          <div className="relative min-w-[60rem]">
            <div className="absolute left-[2%] right-[2%] top-[11px] h-[3px] rounded-full bg-border">
              <i className="block h-full rounded-full bg-success" style={{ width: `${(reach / stages.length) * 100}%` }} />
            </div>
            <div className="relative grid" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
              {stages.map((s) => {
                const st = s.view.state;
                return (
                  <div key={s.key} className="flex min-w-0 flex-col items-center gap-0.5 px-0.5 text-center" title={s.note ?? undefined}>
                    <span
                      className={cn("z-10 grid size-6 place-items-center rounded-full border-2 bg-surface text-xs font-bold text-white", st === "in_progress" && "ring-4 ring-primary-soft")}
                      style={{
                        borderColor: DOT[st],
                        background: st === "done" || st === "done_late" || st === "overdue" ? DOT[st] : "var(--surface)",
                      }}
                    >
                      {st === "done" || st === "done_late" ? "✓" : st === "overdue" ? "!" : st === "in_progress" ? <i className="size-2 rounded-full bg-info" /> : ""}
                    </span>
                    <span className={cn("mt-1 min-h-7 text-[11px] leading-tight", st === "overdue" ? "font-semibold text-danger" : st === "pending" ? "text-muted-foreground" : "text-foreground")}>
                      {s.label}
                    </span>
                    <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted-foreground">
                      {s.actual ? fmtDate(s.actual).slice(0, 5) : s.plan ? `by ${fmtDate(s.plan).slice(0, 5)}` : "not planned"}
                    </span>
                    <Delta s={s} />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1 border-t border-border pt-1">
              {GROUP_ORDER.map((g) => {
                const n = stages.filter((s) => s.group === g).length;
                return n ? (
                  <span key={g} className="text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground" style={{ flex: n }}>
                    {STAGE_GROUP_LABELS[g]}
                  </span>
                ) : null;
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Three cards */}
      <div className="grid gap-2.5 lg:grid-cols-3">
        <InfoCard tone={hold?.view.state === "overdue" ? "danger" : i.bucket === "done" ? "success" : undefined} title={hold?.view.state === "overdue" ? "Holding it up" : i.bucket === "done" ? "Shipped" : "Working on now"}>
          {hold ? (
            <>
              <p className="text-base font-semibold">{hold.label}</p>
              <p className="text-xs text-muted-foreground">
                {hold.plan ? (hold.view.state === "overdue" ? <>Was due {fmtDate(hold.plan)} · <b className="text-danger">{hold.view.daysLate} days late</b></> : <>Due {fmtDate(hold.plan)}</>) : "No plan date on the T&A"}
              </p>
              {hold.qtyTarget ? (
                <>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-muted">
                    <i className={cn("block h-full", hold.view.state === "overdue" ? "bg-danger" : "bg-info")} style={{ width: `${Math.min(100, ((hold.qtyDone ?? 0) / hold.qtyTarget) * 100)}%` }} />
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {fmtNumber(hold.qtyDone)} of {fmtNumber(hold.qtyTarget)} pieces
                  </p>
                </>
              ) : hold.note ? (
                <p className="text-xs text-muted-foreground">{hold.note}</p>
              ) : null}
              {hold.href && (
                <Link href={hold.href} className="mt-auto pt-1 text-xs font-semibold text-primary hover:underline">
                  Open {hold.label} →
                </Link>
              )}
            </>
          ) : (
            <p className="text-base font-semibold">All stages done</p>
          )}
        </InfoCard>

        <InfoCard title="Pieces through production">
          <p className="mb-1 text-xs text-muted-foreground">Order quantity {fmtNumber(i.row.orderQty)} pcs</p>
          {flow.map((s) => {
            const pc = s.qtyTarget ? Math.min(100, Math.round(((s.qtyDone ?? 0) / s.qtyTarget) * 100)) : 0;
            return (
              <div key={s.key} className="grid grid-cols-[3.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 py-0.5 text-[12.5px]">
                <span>{s.key === "SHIP" ? "Shipped" : s.label}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-surface-muted">
                  <i
                    className={cn("block h-full rounded-full", s.view.state === "overdue" ? "bg-danger" : s.view.state === "done" || s.view.state === "done_late" ? "bg-success" : "bg-info")}
                    style={{ width: `${pc}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  {fmtNumber(s.qtyDone ?? 0)} <span className="text-[11px] text-muted-foreground">{pc}%</span>
                </span>
              </div>
            );
          })}
        </InfoCard>

        <InfoCard tone={i.bucket === "late" ? "danger" : i.bucket === "risk" ? "warning" : i.bucket === "done" ? "success" : undefined} title="Delivery outlook">
          <p className="text-base font-semibold">
            {i.bucket === "done"
              ? "Shipped"
              : left == null
                ? "No delivery date"
                : i.bucket === "late"
                  ? `${-left} days past delivery`
                  : i.bucket === "risk" && risk.projected
                    ? `May slip ${risk.daysLate} days`
                    : `${left} days to go`}
          </p>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p>
              Delivery <b className="text-foreground">{fmtDate(i.row.deliveryDate)}</b>
            </p>
            {risk.projected && (
              <p>
                Projected <b className="text-warning">{fmtDate(risk.projected)}</b>
              </p>
            )}
            {i.row.deliveryDate && i.bucket !== "done" && (
              <p>{daysBetween(today, i.row.deliveryDate) >= 0 ? `${daysBetween(today, i.row.deliveryDate)} calendar days from today` : "Delivery date has passed"}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {i.bucket === "risk"
              ? `${risk.cause ?? "A stage is behind"}. Later stages have no spare days, so delivery moves by the same amount.`
              : i.bucket === "late"
                ? `${fmtNumber(i.shipped)} of ${fmtNumber(i.row.orderQty)} pieces shipped so far.`
                : i.bucket === "none"
                  ? "No T&A plan yet, so there is nothing to judge against."
                  : i.bucket === "done"
                    ? "Nothing to chase."
                    : "Every stage is on or ahead of plan."}
          </p>
        </InfoCard>
      </div>

      {/* 3. Full schedule, folded */}
      <details>
        <summary className="cursor-pointer text-[12.5px] font-semibold text-primary">Show full schedule</summary>
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[12.5px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {["Stage", "Group", "Plan", "Actual", "Early / late", "Pieces", "Judged by"].map((h) => (
                  <th key={h} className="py-1 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s.key} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3">
                    <i className="mr-2 inline-block size-2 rounded-full" style={{ background: DOT[s.view.state] }} />
                    {s.label}
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{STAGE_GROUP_LABELS[s.group]}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmtDate(s.plan)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmtDate(s.actual)}</td>
                  <td className="py-1.5 pr-3">
                    <Delta s={s} />
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{s.qtyTarget ? `${fmtNumber(s.qtyDone)} / ${fmtNumber(s.qtyTarget)}` : ""}</td>
                  <td className="py-1.5 text-xs text-muted-foreground">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function InfoCard({ title, tone, children }: { title: string; tone?: "danger" | "warning" | "success"; children: React.ReactNode }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-3.5 py-2.5"
      style={tone ? { boxShadow: `inset 3px 0 0 var(--${tone})` } : undefined}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}
