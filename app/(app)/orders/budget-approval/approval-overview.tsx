"use client";

import { useState, type ReactNode } from "react";
import { Ban, Check, ChevronRight, Clock, RotateCcw, UserCog, X, AlertTriangle } from "lucide-react";
import { BudgetBreakdownChart } from "@/components/orders/budget-breakdown-chart";
import { OrderFullDataSheet } from "@/components/approvals/order-full-data-sheet";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_SOURCE_LABELS,
  isRefusal,
  suppressedRefusal,
  type BudgetSource,
  type BudgetTotals,
  type Refusal,
} from "@/lib/orders/budget/totals";
import { MARGIN_TARGET_PCT, bucketLabelOfSource, perPiece } from "@/lib/orders/budget/breakdown";
import type { OrderApprovalCard } from "@/lib/approvals/order-approval-cards";
import type { EventAction, TimelineRow } from "@/lib/approvals/types";

/**
 * THE DESKTOP APPROVAL PAGE'S BODY (user 2026-09-30, screenshots 3162 / 3163,
 * canvas "Approval Desktop Layout"). The phone card stretched to 36rem left
 * half the full-page sheet empty, and the same figures were printed twice
 * ("Figures" and "As submitted"), so the decision sat three screens down.
 *
 * Laid out to fit one desktop screen, two rows:
 *   Order facts · Where the sales go (the glass ring, wide) · Margin vs 15%
 *   Cost lines — every source, its chart group, amount, % of sales, per piece
 * The approval steps are one line (`ApprovalStrip`) and the decision is in the
 * sheet's footer, so neither needs scrolling to.
 *
 * Every figure comes from what the page already holds — the live `totals` and
 * the submitted `card` — and a refusal prints its reason in place of a number:
 * an MD must never approve a "0" that really means "not known".
 */
type BudgetFacts = {
  currency_code: string | null;
  exchange_rate: number | null;
  budget_date: string | null;
  submitted_at: string | null;
  decided_at: string | null;
};

const figText = (v: number | Refusal | null | undefined, suffix = "") =>
  v == null ? "—" : isRefusal(v) ? v.refused : `${fmtNumber(v)}${suffix}`;

export function ApprovalOverview({
  card,
  budget,
  totals,
  revision = false,
}: {
  card: OrderApprovalCard | undefined;
  budget: BudgetFacts;
  totals: BudgetTotals;
  revision?: boolean;
}) {
  const [fullOpen, setFullOpen] = useState(false);
  const soId = card?.salesOrderIds[0] ?? null;
  const qty = card?.orderQty ?? null;
  const unit = card?.orderUnit && !isRefusal(card.orderUnit) ? ` ${card.orderUnit}` : "";
  const profit = suppressedRefusal(totals.profit, totals);
  const pct = suppressedRefusal(totals.profitPct, totals);
  const bd = card?.breakdown;

  /* THE COST LINES — every source that carries an amount, in the budget's own
     source order. `% of sales` needs a known, positive sales value. */
  const sales = totals.sales;
  const salesKnown = typeof sales === "number" && sales > 0;
  const lines = (Object.keys(BUDGET_SOURCE_LABELS) as BudgetSource[])
    .filter((k) => k !== "income" && totals.costBySource[k] !== 0)
    .map((k) => ({ key: k, amount: totals.costBySource[k] }));
  const share = (v: number | Refusal) =>
    isRefusal(v) ? "—" : salesKnown ? `${fmtNumber((v / (sales as number)) * 100)}%` : "—";

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)_19rem]">
      {/* 1. THE ORDER */}
      <Box title="Order">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Qty" value={qty == null ? null : isRefusal(qty) ? qty.refused : `${fmtNumber(qty)}${unit}`} />
          <Fact label="Earliest ship" value={card?.earliestShipment ? fmtDate(card.earliestShipment) : null} />
          <Fact label="Merchandiser" value={card?.merchandiser ?? null} span />
          <Fact
            label="Currency"
            value={budget.currency_code ? `${budget.currency_code} @ ${fmtNumber(budget.exchange_rate ?? 1)}` : null}
          />
          <Fact label="Budget date" value={budget.budget_date ? fmtDate(budget.budget_date) : null} />
          <Fact
            label="Submitted"
            value={
              budget.submitted_at
                ? `${fmtDateTime(budget.submitted_at)}${card?.submittedBy ? ` · ${card.submittedBy}` : ""}`
                : null
            }
            span
          />
          {budget.decided_at && <Fact label="Decided" value={fmtDateTime(budget.decided_at)} span />}
        </dl>
        {soId && (
          <button
            type="button"
            onClick={() => setFullOpen(true)}
            className="mt-auto inline-flex items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-xs font-medium text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View full order data
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        )}
        {soId && fullOpen && (
          <OrderFullDataSheet
            open
            onClose={() => setFullOpen(false)}
            salesOrderId={soId}
            title={card?.reNos.join(", ") ?? ""}
            revision={revision}
          />
        )}
      </Box>

      {/* 2. WHERE THE SALES GO — the same glass ring as the phone card, wide. */}
      <div className="min-w-0">
        {bd?.ok ? (
          <BudgetBreakdownChart current={bd.current} compare={false} wide />
        ) : (
          <Box title="Where the sales go">
            <p className="text-sm text-warning">Breakdown unavailable{bd && !bd.ok ? ` — ${bd.refused}` : ""}</p>
          </Box>
        )}
      </div>

      {/* 3. THE MARGIN, AGAINST THE LINE */}
      <Box title="Margin">
        <MarginGauge pct={pct} />
        <dl className="grid grid-cols-3 gap-x-3 gap-y-3 border-t border-border pt-3">
          <Fact label="Sales" value={figText(totals.sales)} />
          <Fact label="Total cost" value={figText(totals.cost)} />
          <Fact label="Profit" value={figText(profit)} tone={signTone(profit)} />
          <Fact label="Sales / pc" value={figText(perPiece(totals.sales, qty))} />
          <Fact label="Cost / pc" value={figText(perPiece(totals.cost, qty))} />
          <Fact label="Profit / pc" value={figText(perPiece(profit, qty))} tone={signTone(profit)} />
        </dl>
      </Box>

      {/* 4. THE COST LINES, full width */}
      <Box title="Cost lines" className="lg:col-span-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="py-2 pr-3 text-left font-semibold">Head</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Group</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">% of sales</th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">Per piece</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {lines.map((l) => (
                <tr key={l.key} className="border-b border-border/60">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">{BUDGET_SOURCE_LABELS[l.key]}</th>
                  <td className="px-3 py-2 text-muted-foreground">{bucketLabelOfSource(l.key) ?? "—"}</td>
                  <td className={cn("px-3 py-2 text-right", isRefusal(l.amount) && "text-danger")}>{figText(l.amount)}</td>
                  <td className="px-3 py-2 text-right">{share(l.amount)}</td>
                  <td className="py-2 pl-3 text-right">{figText(perPiece(l.amount, qty))}</td>
                </tr>
              ))}
              <tr className="bg-surface-muted font-semibold">
                <th scope="row" className="py-2 pr-3 text-left">Total cost</th>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right">{figText(totals.cost)}</td>
                <td className="px-3 py-2 text-right">{share(totals.cost)}</td>
                <td className="py-2 pl-3 text-right">{figText(perPiece(totals.cost, qty))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {totals.unpriced.length > 0 && (
          <p className="text-xs text-danger">
            {totals.unpriced.length} cost {totals.unpriced.length === 1 ? "line is" : "lines are"} unpriced and
            excluded from these figures.
          </p>
        )}
        {totals.pending.length > 0 && (
          <p className="text-xs text-danger">
            {totals.pending.length} {totals.pending.length === 1 ? "line is" : "lines are"} waiting on a sales value.
          </p>
        )}
      </Box>
    </div>
  );
}

function Box({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Fact({
  label,
  value,
  span = false,
  tone,
}: {
  label: string;
  value: string | null;
  span?: boolean;
  tone?: string;
}) {
  return (
    <div className={cn("min-w-0", span && "col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-semibold tabular-nums", tone)}>
        {value ?? <span className="font-normal text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

const signTone = (v: number | Refusal) =>
  isRefusal(v) ? "text-warning" : v < 0 ? "text-danger" : "text-success";

/**
 * NET MARGIN ON A 0–30% SCALE WITH THE 15% LINE MARKED — green at or above
 * the line, amber below, and the words say which so colour is never the only
 * carrier (the same rule as the phone card's `MarginLine`).
 */
function MarginGauge({ pct }: { pct: number | Refusal }) {
  if (isRefusal(pct)) return <p className="text-sm text-warning">Net margin — {pct.refused}</p>;
  const ok = pct >= MARGIN_TARGET_PCT;
  const SCALE = MARGIN_TARGET_PCT * 2;
  const fill = Math.max(0, Math.min(1, pct / SCALE)) * 100;
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn("text-3xl font-bold tabular-nums", ok ? "text-success" : "text-warning")}>
          {fmtNumber(pct)}%
        </span>
        <span className={cn("text-sm font-medium", ok ? "text-success" : "text-warning")}>
          {ok ? `at or above the ${MARGIN_TARGET_PCT}% line` : `below the ${MARGIN_TARGET_PCT}% line`}
        </span>
      </p>
      <div className="relative h-2 rounded-full bg-surface-muted" aria-hidden>
        <div className={cn("h-2 rounded-full", ok ? "bg-success" : "bg-warning")} style={{ width: `${fill}%` }} />
        <div className="absolute left-1/2 top-[-4px] h-4 w-0.5 bg-foreground" />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>0%</span>
        <span>{MARGIN_TARGET_PCT}% target</span>
        <span>{SCALE}%</span>
      </div>
    </div>
  );
}

const STEP_ICON: Record<EventAction, typeof Check> = {
  submit: Clock,
  approve: Check,
  reject: X,
  return: RotateCcw,
  cancel: Ban,
  delegate: UserCog,
  sla_breach: AlertTriangle,
};
const STEP_WORD: Record<EventAction, string> = {
  submit: "Submitted",
  approve: "Approved",
  reject: "Sent back",
  return: "Returned",
  cancel: "Cancelled",
  delegate: "Delegated",
  sla_breach: "Overdue",
};

/**
 * THE APPROVAL STEPS AS ONE LINE (user 2026-09-30: "compact the approval step
 * section"). The full `ApprovalTimeline` stacked a boxed row per step; on a
 * one- or two-step chain that was a quarter of the screen for two facts. Each
 * step keeps what the timeline said — who, what, when, and a comment — with the
 * comment on hover.
 */
export function ApprovalStrip({
  rows,
  names,
  lead,
}: {
  rows: TimelineRow[];
  names: Record<string, string>;
  /** Printed before the steps, e.g. who submitted it. */
  lead?: string | null;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Approval</span>
      {lead && (
        <span className="inline-flex items-center gap-1.5">
          <Dot tone="done">
            <Check className="size-3" aria-hidden />
          </Dot>
          <span className="font-semibold">Submitted</span>
          <span className="text-muted-foreground">{lead}</span>
        </span>
      )}
      {rows.map((r, i) => {
        const Icon = r.action ? STEP_ICON[r.action] : Clock;
        const actor = r.actor_id ? names[r.actor_id] : null;
        const tone = r.action === "approve" ? "done" : r.action ? "bad" : r.is_current ? "wait" : "idle";
        return (
          <span key={`${r.step_order}-${i}`} className="inline-flex items-center gap-1.5" title={r.comment ?? undefined}>
            {(lead || i > 0) && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
            <Dot tone={tone}>
              <Icon className="size-3" aria-hidden />
            </Dot>
            <span className="font-semibold">
              Step {r.step_order} · {r.step_label}
            </span>
            <span className={cn(tone === "wait" ? "text-warning" : "text-muted-foreground")}>
              {r.action ? STEP_WORD[r.action] : r.is_current ? "waiting" : "next"}
              {actor ? ` · ${actor}` : ""}
              {r.acted_at ? ` · ${fmtDateTime(r.acted_at)}` : ""}
              {r.is_override ? " · override" : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function Dot({ tone, children }: { tone: "done" | "bad" | "wait" | "idle"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-full",
        tone === "done" && "bg-success/15 text-success",
        tone === "bad" && "bg-danger/15 text-danger",
        tone === "wait" && "bg-warning/15 text-warning",
        tone === "idle" && "border border-dashed border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
