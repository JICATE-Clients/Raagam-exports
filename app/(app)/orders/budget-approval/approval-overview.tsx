"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronRight,
  Clock,
  FileText,
  RotateCcw,
  UserCog,
  X,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { BudgetBreakdownChart } from "@/components/orders/budget-breakdown-chart";
import { OrderFullDataSheet } from "@/components/approvals/order-full-data-sheet";
import { fmtDate, fmtDateTime, fmtFixed, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_SOURCE_LABELS,
  isRefusal,
  suppressedRefusal,
  type BudgetSource,
  type BudgetTotals,
  type Refusal,
} from "@/lib/orders/budget/totals";
import { MARGIN_TARGET_PCT, bucketLabelOfSource, perPiece, varianceRows } from "@/lib/orders/budget/breakdown";
import { VarianceTable } from "@/components/approvals/order-approval-card";
import { budgetStatusText, budgetStatusTone, type BudgetStatus } from "@/lib/orders/budget/types";
import type { OrderApprovalCard } from "@/lib/approvals/order-approval-cards";
import type { EventAction, TimelineRow } from "@/lib/approvals/types";

/**
 * THE DESKTOP APPROVAL PAGE, IN THE STAFF PROFILE'S LAYOUT (user 2026-09-30:
 * "the staff profile view UI looks a good fit for this desktop approval";
 * canvas "Approval Desktop Layout", board B). The same bento the HR ▸ Staff
 * details page uses (`hr/_person/person-profile-view.tsx`), so the approver
 * reads an order the way they already read a person:
 *
 *   profile card      → the ORDER: initials tile, RE No, customer, version and
 *                       status pills, then its key facts
 *   personal info     → Order Info: merchandiser, submitted, full order data
 *   completeness rings→ four tiles: Sales · Total cost · Profit · margin ring
 *   pay structure     → where the sales go (the glass ring, `wide`)
 *   documents         → the cost lines, every source with its chart group
 *   calendar          → the approval trail
 *   payroll summary   → per-piece summary: sold at, costs by group, profit
 *
 * The decision (Approve · Request Rework) is the page's header action, where
 * "Edit staff" sits on the profile; the comment is asked for by its confirm
 * step. The override warning moves to the right column (`overrideNote`).
 *
 * Every figure is the page's own — the live `totals` and the submitted `card` —
 * and a refusal prints its reason in place of a number: an MD must never
 * approve a "0" that really means "not known".
 */
type BudgetFacts = {
  code: string | null;
  status: BudgetStatus;
  currency_code: string | null;
  exchange_rate: number | null;
  budget_date: string | null;
  submitted_at: string | null;
  decided_at: string | null;
};

/* Two decimals everywhere a figure sits in a column — "5,00,304.00" beside
   "2,13,518.22", never "5,00,304" (screenshot 3166). */
const figText = (v: number | Refusal | null | undefined, suffix = "") =>
  v == null ? "—" : isRefusal(v) ? v.refused : `${fmtFixed(v)}${suffix}`;

/** "AARSAN AMERICAS LLC" → "AA" — the profile tile's letters, for a customer. */
const initialsOf = (s: string | null | undefined) =>
  (s ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function ApprovalOverview({
  card,
  budget,
  totals,
  timeline,
  names,
  override = false,
  children,
}: {
  card: OrderApprovalCard | undefined;
  budget: BudgetFacts;
  totals: BudgetTotals;
  /** The run's steps, or null when the budget has no run. */
  timeline: TimelineRow[] | null;
  names: Record<string, string>;
  /** The viewer would act as an override — said in the right column. */
  override?: boolean;
  /** Sections that follow the cost lines in the middle column (a revision's
   *  comparison, an unresolved order, the legacy decide block). */
  children?: ReactNode;
}) {
  const [fullOpen, setFullOpen] = useState(false);
  const soId = card?.salesOrderIds[0] ?? null;
  const revision = !!card?.revision;
  const qty = card?.orderQty ?? null;
  const unit = card?.orderUnit && !isRefusal(card.orderUnit) ? ` ${card.orderUnit}` : "";
  const profit = suppressedRefusal(totals.profit, totals);
  const pct = suppressedRefusal(totals.profitPct, totals);
  const bd = card?.breakdown;
  const reNo = card?.reNos.join(", ") || `Budget ${budget.code ?? ""}`;

  const sales = totals.sales;
  const salesKnown = typeof sales === "number" && sales > 0;
  const lines = (Object.keys(BUDGET_SOURCE_LABELS) as BudgetSource[])
    .filter((k) => k !== "income" && totals.costBySource[k] !== 0)
    .map((k) => ({ key: k, amount: totals.costBySource[k] }));
  const share = (v: number | Refusal) =>
    isRefusal(v) ? "—" : salesKnown ? `${fmtFixed((v / (sales as number)) * 100)}%` : "—";

  return (
    <div className="grid items-start gap-3 xl:grid-cols-12">
      {/* ═══ LEFT — the order's identity, as the profile card ═══
          ONE card, identity beside the tile rather than stacked under it
          (screenshot 3166): the profile's two tall cards pushed this column
          past the screen on their own. */}
      <div className="xl:col-span-3">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-primary-soft text-lg font-bold text-primary">
                {initialsOf(card?.customer) || <FileText aria-hidden className="size-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold text-foreground">{reNo}</div>
                <Truncated text={card?.customer ?? "—"} className="block text-xs text-muted-foreground" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone="info">
                {card?.revision
                  ? `${card.revision.entryNo ?? "Revision"}${card.revision.revNo ? ` · Rev #${card.revision.revNo}` : ""}`
                  : "V0 · First budget"}
              </StatusPill>
              <StatusPill tone={budgetStatusTone(budget.status)}>{budgetStatusText(budget.status)}</StatusPill>
            </div>
            <dl className="divide-y divide-border rounded-lg border border-border">
              {(
                [
                  ["Style", card?.styles ?? null],
                  ["Order qty", qty == null ? null : isRefusal(qty) ? qty.refused : `${fmtNumber(qty)}${unit}`],
                  ["Earliest ship", card?.earliestShipment ? fmtDate(card.earliestShipment) : null],
                  [
                    "Currency",
                    budget.currency_code ? `${budget.currency_code} @ ${fmtFixed(budget.exchange_rate ?? 1)}` : null,
                  ],
                  [
                    "Budget",
                    `No. ${budget.code ?? "—"}${budget.budget_date ? ` · ${fmtDate(budget.budget_date)}` : ""}`,
                  ],
                  ["Merchandiser", card?.merchandiser ?? null],
                  ["Submitted by", card?.submittedBy ?? null],
                  ["Submitted", budget.submitted_at ? fmtDateTime(budget.submitted_at) : null],
                  ...(budget.decided_at ? ([["Decided", fmtDateTime(budget.decided_at)]] as [string, string][]) : []),
                ] as [string, string | null][]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
                  <dd className="m-0 min-w-0 text-right">
                    <Truncated text={value ?? "—"} className="block text-xs font-semibold text-foreground" />
                  </dd>
                </div>
              ))}
            </dl>
            {soId && (
              <button
                type="button"
                onClick={() => setFullOpen(true)}
                className="flex w-full items-center justify-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                title={reNo}
                revision={revision}
              />
            )}
          </CardBody>
        </Card>
      </div>

      {/* ═══ MIDDLE — tiles, the ring, the cost lines ═══ */}
      <div className="min-w-0 space-y-3 xl:col-span-6">
        {/* CLICK ANYWHERE ON THE BUDGET OPENS THE ORDER'S FULL DATA
            (budgetupdate.md §7D) — tiles, ring and cost lines, as the phone
            card's budget block does. The pointer's way in only: the real
            <button> in the left card ("View full order data") is the
            keyboard's and the screen reader's, so this is never mouse-only.
            A tap on a ring colour stops at the chart (it picks the colour). */}
        <div
          className={cn("space-y-3", soId && "cursor-pointer")}
          onClick={soId ? () => setFullOpen(true) : undefined}
        >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Sales value" value={figText(totals.sales)} sub={perPcText(perPiece(totals.sales, qty))} tone="text-primary" />
          <Tile label="Total cost" value={figText(totals.cost)} sub={perPcText(perPiece(totals.cost, qty))} />
          <Tile label="Profit" value={figText(profit)} sub={perPcText(perPiece(profit, qty))} tone={signTone(profit)} />
          <MarginTile pct={pct} />
        </div>

        {bd?.ok ? (
          <BudgetBreakdownChart current={bd.current} compare={false} wide />
        ) : (
          <Card>
            <CardBody>
              <p className="text-sm text-warning">Breakdown unavailable{bd && !bd.ok ? ` — ${bd.refused}` : ""}</p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Cost Lines</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-1.5 pr-3 text-left font-semibold">Head</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-semibold">Group</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">Amount</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">% sales</th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Per pc</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {lines.map((l) => (
                    <tr key={l.key} className="border-b border-border/60">
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">{BUDGET_SOURCE_LABELS[l.key]}</th>
                      <td className="px-3 py-1.5 text-muted-foreground">{bucketLabelOfSource(l.key) ?? "—"}</td>
                      <td className={cn("px-3 py-1.5 text-right", isRefusal(l.amount) && "text-danger")}>{figText(l.amount)}</td>
                      <td className="px-3 py-1.5 text-right">{share(l.amount)}</td>
                      <td className="py-1.5 pl-3 text-right">{figText(perPiece(l.amount, qty))}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-muted font-semibold">
                    <th scope="row" className="py-1.5 pr-3 text-left">Total cost</th>
                    <td className="px-3 py-1.5" />
                    <td className="px-3 py-1.5 text-right">{figText(totals.cost)}</td>
                    <td className="px-3 py-1.5 text-right">{share(totals.cost)}</td>
                    <td className="py-1.5 pl-3 text-right">{figText(perPiece(totals.cost, qty))}</td>
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
                {totals.pending.length} {totals.pending.length === 1 ? "line is" : "lines are"} waiting on a sales
                value.
              </p>
            )}
          </CardBody>
        </Card>

        </div>

        {children}
      </div>

      {/* ═══ RIGHT — the trail, the per-piece summary, the override ═══ */}
      <div className="space-y-3 xl:col-span-3">
        {timeline && timeline.length > 0 && (
          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Approval</h2>
              <ApprovalTrail
                rows={timeline}
                names={names}
                submitted={
                  budget.submitted_at
                    ? `${card?.submittedBy ? `${card.submittedBy} · ` : ""}${fmtDateTime(budget.submitted_at)}`
                    : null
                }
              />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Per Piece Summary</h2>
            <table className="w-full text-sm">
              <tbody className="tabular-nums">
                <SummaryGroup title="Sold at" />
                <SummaryRow label="Sales" value={perPiece(totals.sales, qty)} />
                <SummaryGroup title="Costs" />
                {bd?.ok
                  ? bd.current.buckets.map((b) => (
                      <SummaryRow key={b.key} label={b.label} value={perPiece(b.amount, qty)} />
                    ))
                  : null}
                <SummaryRow label="Total cost" value={perPiece(totals.cost, qty)} strong rule />
                <SummaryRow label="Profit" value={perPiece(profit, qty)} strong tone={signTone(profit)} />
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground">Per piece sold — the order quantity.</p>
          </CardBody>
        </Card>

        {/* V0 vs PROPOSED, BY BUCKET (budgetupdate.md §7C: "a right-aligned
            financial matrix comparing the baseline approved budget (V0)
            against the proposed budget") — the phone card's own table, per
            piece sold, on a revision only. The desktop page dropped it when
            the card went; the by-cost-head comparison below the cost lines
            answers a different question (which lines moved). */}
        {bd?.ok && bd.original && (
          <VarianceTable
            rows={varianceRows(bd.original, bd.current, card?.v0Qty ?? null, qty)}
            revNo={card?.revision?.revNo ?? null}
          />
        )}

        {/* THE OVERRIDE, SAID BEFORE THE CLICK — moved here from the action
            bar, which now sits in the page header (`overrideNote={false}`). */}
        {override && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            You are not an approver on this step — acting here is recorded as an override.
          </div>
        )}
      </div>
    </div>
  );
}

const perPcText = (v: number | Refusal) => (isRefusal(v) ? v.refused : `${fmtFixed(v)} / pc`);

const signTone = (v: number | Refusal) =>
  isRefusal(v) ? "text-warning" : v < 0 ? "text-danger" : "text-success";


/* THE FOUR KPI TILES, COMPACT (user 2026-09-30) — a plain bordered block,
   left-aligned, one short line each, instead of the profile's centred Card
   tiles: the row now costs ~64px rather than ~120px of the screen. */
const TILE = "min-w-0 rounded-xl border border-border bg-surface px-3 py-2";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={TILE}>
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className={cn("truncate text-base font-bold leading-6 tabular-nums", tone)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

/**
 * NET MARGIN AS A RING — a METER, as the profile's completeness rings are: the
 * fill is the margin on a 0–30% scale (the 15% line at half way), green at or
 * above the line and amber below, and the words say which.
 */
function MarginTile({ pct }: { pct: number | Refusal }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const ok = !isRefusal(pct) && pct >= MARGIN_TARGET_PCT;
  const frac = isRefusal(pct) ? 0 : Math.max(0, Math.min(1, pct / (MARGIN_TARGET_PCT * 2)));
  return (
    <div className={cn(TILE, "flex items-center gap-2.5")}>
      <svg viewBox="0 0 64 64" className="size-10 shrink-0 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="9" className="stroke-surface-muted" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          className={ok ? "stroke-success" : "stroke-warning"}
        />
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-muted-foreground">Net margin</div>
        <div className={cn("text-base font-bold leading-6 tabular-nums", isRefusal(pct) ? "text-warning" : ok ? "text-success" : "text-warning")}>
          {isRefusal(pct) ? "—" : `${fmtFixed(pct, 1)}%`}
        </div>
        <div className={cn("truncate text-[11px]", isRefusal(pct) ? "text-warning" : ok ? "text-success" : "text-warning")}>
          {isRefusal(pct) ? pct.refused : ok ? `above ${MARGIN_TARGET_PCT}% line` : `below ${MARGIN_TARGET_PCT}% line`}
        </div>
      </div>
    </div>
  );
}

function SummaryGroup({ title }: { title: string }) {
  return (
    <tr>
      <td colSpan={2} className="pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </td>
    </tr>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
  rule = false,
  tone,
}: {
  label: string;
  value: number | Refusal;
  strong?: boolean;
  rule?: boolean;
  tone?: string;
}) {
  return (
    <tr className={cn(strong && "font-semibold", tone)}>
      <td className={cn("py-0.5", rule && "border-t border-border pt-1.5")}>{label}</td>
      <td className={cn("py-0.5 text-right", rule && "border-t border-border pt-1.5")}>{figText(value)}</td>
    </tr>
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
  reject: "Sent back for rework",
  return: "Returned",
  cancel: "Cancelled",
  delegate: "Delegated",
  sla_breach: "Overdue",
};

/**
 * THE APPROVAL TRAIL — the profile's key-dates list, for steps: a dot, the
 * step, what happened, who and when; a step's comment shows under it. Compact
 * on purpose (user 2026-09-30: "compact the approval step section").
 */
function ApprovalTrail({
  rows,
  names,
  submitted,
}: {
  rows: TimelineRow[];
  names: Record<string, string>;
  submitted: string | null;
}) {
  return (
    <ol className="space-y-2.5">
      {submitted && (
        <TrailItem tone="done" icon={Check} title="Submitted" line={submitted} />
      )}
      {rows.map((r, i) => {
        const actor = r.actor_id ? names[r.actor_id] : null;
        const tone = r.action === "approve" ? "done" : r.action ? "bad" : r.is_current ? "wait" : "idle";
        return (
          <TrailItem
            key={`${r.step_order}-${i}`}
            tone={tone}
            icon={r.action ? STEP_ICON[r.action] : Clock}
            title={`Step ${r.step_order} · ${r.step_label}`}
            line={[
              r.action ? STEP_WORD[r.action] : r.is_current ? "Waiting" : "Next",
              actor,
              r.acted_at ? fmtDateTime(r.acted_at) : null,
              r.is_override ? "override" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            comment={r.comment}
          />
        );
      })}
    </ol>
  );
}

function TrailItem({
  tone,
  icon: Icon,
  title,
  line,
  comment,
}: {
  tone: "done" | "bad" | "wait" | "idle";
  icon: typeof Check;
  title: string;
  line: string;
  comment?: string | null;
}) {
  return (
    <li className="flex gap-2.5">
      <span
        className={cn(
          "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full",
          tone === "done" && "bg-success/15 text-success",
          tone === "bad" && "bg-danger/15 text-danger",
          tone === "wait" && "bg-warning/15 text-warning",
          tone === "idle" && "border border-dashed border-border text-muted-foreground",
        )}
      >
        <Icon className="size-3" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className={cn("text-[11px]", tone === "wait" ? "text-warning" : "text-muted-foreground")}>{line}</div>
        {comment && <p className="mt-0.5 text-xs text-foreground">“{comment}”</p>}
      </div>
    </li>
  );
}
