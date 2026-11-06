"use client";

import { PersonAvatar } from "@/components/ui/person-avatar";

import { useMemo, useRef, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { BackLink } from "@/components/ui/back-link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, FileText, PieChart, Shirt, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { overrideApproveRemark } from "@/components/approvals/approval-action-bar";
import { actOnRun } from "@/lib/approvals/actions";
import { loadRunTimeline } from "@/lib/approvals/status-actions";
import { approvePo } from "@/lib/purchase/po-actions";
import { WORKFLOWS, workflowLabel } from "@/lib/approvals/workflows";
import { statusTone } from "@/lib/ui/status-tone";
import { isRefusal } from "@/lib/orders/material-bom/requirement";
import { fmtDateTime, fmtFixed, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CanActVerdict, MyDecisionItem, RunTimelineResult } from "@/lib/approvals/types";
import type { PoApprovalCard, PoChangeCard } from "@/lib/approvals/po-approval-cards";
import type { OrderApprovalCard } from "@/lib/approvals/order-approval-cards";
import type { QueueRow, RequestRow } from "@/app/(app)/approvals/approvals-inbox-screen";

/**
 * MY APPROVALS ON A PHONE (user 2026-11-04, approved mockup "My Approvals Mobile").
 *
 *   To decide   — ONE card shape for every workflow: what it is, its number, who,
 *                 the money, ONE key fact (with a small ring where there is a
 *                 figure to judge), how long it has waited. Overdue first.
 *   My requests — what I raised and where it stands: a step track and one status word.
 *   Decided     — what I approved or sent back.
 *
 * Tap a To-decide card for the decision sheet (the figures, the charts and the
 * buttons — the inbox owns it). Tap a status card for its timeline.
 *
 * ## APPROVE ON THE CARD IS TWO TAPS, AND STILL THE ONE DECISION PATH
 *
 * The inbox's rule is "no approving without the figures" — and the card carries
 * them: the total, the key fact, the ring. What it must not be is a single stray
 * tap while scrolling, so the first tap arms it ("Tap to confirm", 3 s) and only
 * the second acts. It calls exactly what the sheet's bar calls: `approvePo` for a
 * PO (its own gates: signature, TBA, reopened budget), else `actOnRun` with the
 * row's `lock_version` and, on an override, the bar's own remark. Reject / Return
 * / Request Rework always need a reason, so they stay in the sheet.
 */

type Family = "purchase" | "budget" | "hr" | "sample" | "other";

/** Exported so the desktop table's Document cell draws the same icon well (2026-11-04). */
export const FAMILY: Record<Family, { label: string; icon: typeof FileText; well: string }> = {
  purchase: { label: "Purchase", icon: ShoppingCart, well: "bg-primary/10 text-primary" },
  budget: { label: "Budget", icon: PieChart, well: "bg-success/10 text-success" },
  hr: { label: "HR", icon: CalendarDays, well: "bg-warning/10 text-warning" },
  sample: { label: "Sample", icon: Shirt, well: "bg-info/10 text-info" },
  other: { label: "Other", icon: FileText, well: "bg-surface-muted text-muted-foreground" },
};

export function familyOf(key: string): Family {
  if (key === "purchase_order" || key.startsWith("po_") || key === "purchase_indent") return "purchase";
  if (key.endsWith("_budget") || key === "order_amendment") return "budget";
  if (key.startsWith("sample_")) return "sample";
  if (key.startsWith("timeoff_") || key.startsWith("pf_") || key === "hr_fine" || key === "rc_hire") return "hr";
  return "other";
}

const hrefOf = (workflowKey: string, subjectId: string) =>
  WORKFLOWS[workflowKey as keyof typeof WORKFLOWS]?.href.replace(":id", subjectId) ?? null;

/** A ring that fills to `pct` of `max` — the desktop overview's meter, card-sized. */
export function RingMeter({
  pct,
  max,
  tone,
  target,
  size = 36,
}: {
  pct: number;
  max: number;
  tone: "success" | "warning" | "danger";
  /** A tick where the line is (margin 15%). */
  target?: number;
  size?: number;
}) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, pct / max));
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="32" cy="32" r={R} fill="none" strokeWidth="9" className="stroke-surface-muted" />
      <circle
        cx="32"
        cy="32"
        r={R}
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${f * C} ${C}`}
        className={tone === "danger" ? "stroke-danger" : tone === "warning" ? "stroke-warning" : "stroke-success"}
      />
      {target != null && (
        <line
          x1="32"
          y1="2"
          x2="32"
          y2="11"
          strokeWidth="3"
          className="stroke-foreground"
          transform={`rotate(${(target / max) * 360} 32 32)`}
        />
      )}
    </svg>
  );
}

/** What one To-decide card says, assembled once from whichever card data it has. */
export type CardFace = {
  title: ReactNode;
  sub: string | null;
  amount: string | null;
  amountSub: string | null;
  /** Print the workflow's label above the title (false when the title already is it). */
  kindLine?: boolean;
  /** The one key fact; null when the card has nothing the footer does not already say. */
  fact: string | null;
  factTone: "plain" | "warning" | "danger";
  meter: { pct: number; max: number; tone: "success" | "warning" | "danger"; target?: number } | null;
};

const MARGIN_LINE = 15;

/** ONE description of a request — the phone card's AND the desktop Document cell's (2026-11-04). */
export function faceOf(
  r: QueueRow,
  po: PoApprovalCard | undefined,
  chg: PoChangeCard | undefined,
  budget: OrderApprovalCard | undefined,
  code: string | undefined,
): CardFace {
  if (po) {
    const over = po.overPct != null && po.profitHit != null && po.profitHit > 0;
    return {
      title: <span className="font-mono">{po.code ?? "PO"}</span>,
      sub: po.vendor,
      amount: po.total,
      amountSub: "incl. GST",
      fact: over
        ? `Profit down ₹ ${fmtFixed(po.profitHit ?? 0, 2)} · ${fmtFixed(po.overPct ?? 0, 1)}% over budget`
        : po.overCount == null
          ? `${po.lineCount} line${po.lineCount === 1 ? "" : "s"} · ${po.items[0] ?? ""}`
          : po.unbudgetedCount
            ? `${po.lineCount} line${po.lineCount === 1 ? "" : "s"} · ${po.unbudgetedCount} without a budget`
            : `${po.lineCount} line${po.lineCount === 1 ? "" : "s"} · within budget`,
      factTone: over ? "danger" : po.unbudgetedCount ? "warning" : "plain",
      /* Within budget is a FULL green ring, the desktop tile's own reading — an empty one
         read as "still loading" (screenshot 4041). Over budget fills to its % of 50. */
      meter: po.overPct != null && po.overCount != null ? { pct: over ? (po.overPct ?? 0) : 50, max: 50, tone: over ? "danger" : "success" } : null,
    };
  }
  if (chg) {
    const hit = chg.kind === "rate" && !!chg.profitHit;
    return {
      title: <span className="font-mono">{chg.poCode ? `PO ${chg.poCode}` : "PO"}</span>,
      sub: chg.kind === "rate" ? (chg.item ?? "Rate amendment") : `${chg.scope === "whole" ? "Whole PO" : "Part"} · ${chg.lines.length} line(s)`,
      amount:
        chg.kind === "rate"
          ? `${chg.valueChange >= 0 ? "+" : "−"}${chg.currency} ${fmtFixed(Math.abs(chg.valueChange), 2)}`
          : `${chg.currency} ${fmtFixed(chg.cancelValue, 2)}`,
      amountSub: chg.kind === "rate" ? "on the PO" : "cancelled",
      fact:
        chg.kind === "rate"
          ? `${chg.currency} ${fmtFixed(chg.previousRate, 2)} → ${fmtFixed(chg.revisedRate, 2)}${hit ? ` · profit down ₹ ${fmtFixed(chg.profitHit ?? 0, 2)}` : ""}`
          : (chg.reason ?? "Cancellation"),
      factTone: hit ? "danger" : "plain",
      meter: null,
    };
  }
  if (budget) {
    const k = budget.kpis;
    const pct = k && !isRefusal(k.profit_pct) ? k.profit_pct : null;
    const below = pct != null && pct < MARGIN_LINE;
    return {
      title: <span className="font-mono">{budget.reNos.join(", ") || budget.budgetCode || workflowLabel(r.workflow_key)}</span>,
      sub: [budget.customer, budget.styles].filter(Boolean).join(" · ") || null,
      amount: k && !isRefusal(k.total_income) ? `₹ ${fmtNumber(k.total_income)}` : null,
      amountSub: k ? "gross sales" : null,
      fact:
        pct == null
          ? "Margin not worked out yet"
          : below
            ? `Margin ${fmtFixed(pct, 1)}% — below the ${MARGIN_LINE}% line`
            : `Margin ${fmtFixed(pct, 1)}%`,
      factTone: pct == null ? "warning" : below ? "warning" : "plain",
      meter: pct != null ? { pct: Math.max(0, pct), max: 25, tone: below ? (pct < 0 ? "danger" : "warning") : "success", target: MARGIN_LINE } : null,
    };
  }
  /* NOTHING SAID TWICE (screenshot 4041): with no document number the title IS the
     workflow's name, so the small label above it is dropped; and the step is already in
     the card's footer, so there is no fact box repeating it. */
  return {
    title: code ? <span className="font-mono">{code}</span> : workflowLabel(r.workflow_key),
    kindLine: !!code,
    sub: r.created_by_name ? `Raised by ${r.created_by_name}` : null,
    amount: null,
    amountSub: null,
    fact: null,
    factTone: "plain",
    meter: null,
  };
}

/* ───────────────────────────────────────────── two-tap Approve on a card */

function QuickApprove({ row, verdict }: { row: QueueRow; verdict: CanActVerdict }) {
  /* A Sample PD Request's approve is "Acknowledge" (client spec 2026-10-14) — the engine's
     approve under the department's word, as the decision bar's \cknowledge\ reads it. */
  const verb = row.workflow_key === WORKFLOWS.sample_pd_request.key ? "Acknowledge" : "Approve";
  const router = useRouter();
  const { success, error } = useToast();
  const [armed, setArmed] = useState(false);
  const [isPending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function tap(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (isPending) return;
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    start(async () => {
      let res: { ok: boolean; error?: string };
      try {
        res =
          row.workflow_key === WORKFLOWS.purchase_order.key
            ? await approvePo(row.subject_id)
            : await actOnRun({
                runId: row.run_id,
                action: "approve",
                lockVersion: row.lock_version,
                comment: verdict.is_override ? overrideApproveRemark(verdict.step_label) : undefined,
                subjectPath: "/approvals",
              });
      } catch (err) {
        res = { ok: false, error: err instanceof Error ? err.message : "Could not record the decision" };
      }
      if (res.ok) {
        success(verb === "Acknowledge" ? "Acknowledged" : "Approved");
        router.refresh();
      } else {
        error(res.error ?? "Could not record the decision");
      }
    });
  }

  return (
    <Button
      type="button"
      size="md"
      /* Armed reads GREEN — "this tap will approve" — on the primary button's shape. */
      className={cn(armed && "border-transparent bg-success-solid text-white hover:bg-success-solid-hover")}
      disabled={isPending}
      onClick={tap}
      aria-label={armed ? `Tap again to ${verb.toLowerCase()}` : verb}
    >
      <Check className="h-4 w-4" aria-hidden />
      {isPending ? "Saving…" : armed ? "Tap to confirm" : verb}
    </Button>
  );
}

/* ─────────────────────────────────────────────────────────────── the view */

type Tab = "decide" | "sent" | "decided";

export function ApprovalsPhoneView({
  rows,
  verdicts,
  budgets,
  pos,
  poChanges,
  codes,
  faces = {},
  requests,
  decisions,
  allOpen,
  waited,
  onOpenDecision,
}: {
  rows: QueueRow[];
  verdicts: Record<string, CanActVerdict>;
  budgets: Record<string, OrderApprovalCard>;
  pos: Record<string, PoApprovalCard>;
  poChanges: Record<string, PoChangeCard>;
  /** Document numbers for queue rows that have no richer card, keyed by subject id. */
  codes: Record<string, string>;
  /** HR requests: subject id → person key — the person's photo in place of the type icon. */
  faces?: Record<string, string>;
  requests: RequestRow[];
  decisions: MyDecisionItem[];
  /** Super Admin ▸ All open: the queue only — the status tabs are the caller's own. */
  allOpen: boolean;
  waited: (hours: number) => string;
  onOpenDecision: (r: QueueRow) => void;
}) {
  const [tab, setTab] = useState<Tab>("decide");
  const [family, setFamily] = useState<Family | "all">("all");
  const [timeline, setTimeline] = useState<{ runId: string; title: string; href: string | null; result: RunTimelineResult | null } | null>(
    null,
  );

  const familyCounts = useMemo(() => {
    const list = tab === "decide" ? rows.map((r) => r.workflow_key) : tab === "sent" ? requests.map((r) => r.workflow_key) : decisions.map((d) => d.workflow_key);
    const m = new Map<Family, number>();
    for (const k of list) m.set(familyOf(k), (m.get(familyOf(k)) ?? 0) + 1);
    return { total: list.length, m };
  }, [tab, rows, requests, decisions]);

  const keep = (key: string) => family === "all" || familyOf(key) === family;
  const queue = rows.filter((r) => keep(r.workflow_key));
  const overdue = queue.filter((r) => r.is_overdue);
  const waiting = queue.filter((r) => !r.is_overdue);

  function openTimeline(runId: string, title: string, href: string | null) {
    setTimeline({ runId, title, href, result: null });
    loadRunTimeline(runId)
      .catch((): RunTimelineResult => ({ ok: false, error: "Could not load the approval history" }))
      .then((result) => setTimeline((t) => (t?.runId === runId ? { ...t, result } : t)));
  }

  const card = (r: QueueRow) => {
    const verdict = verdicts[r.run_id];
    const face = faceOf(r, pos[r.subject_id], poChanges[r.subject_id], budgets[r.subject_id], codes[r.subject_id]);
    const fam = FAMILY[familyOf(r.workflow_key)];
    const Icon = fam.icon;
    /* EVERY CARD OPENS THE SHEET IN PLACE (user 2026-11-04, Pulse ▸ My Approvals: no
       jumping to the requesting module) — read-only when this login cannot decide it. */
    const open = () => onOpenDecision(r);
    return (
      <article
        key={r.run_id}
        /* `min-w-0` + one shrinkable column: a card is never wider than the phone
           (screenshot 4041, 320px — the Approve button and the amount ran off the edge). */
        className="grid min-w-0 cursor-pointer grid-cols-1 gap-2 rounded-xl border border-border bg-surface p-3 active:bg-surface-muted"
        onClick={open}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          {faces[r.subject_id] ? (
            <PersonAvatar name={codes[r.subject_id]} person={faces[r.subject_id]} className="h-9 w-9" />
          ) : (
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", fam.well)}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
          )}
          <div className="min-w-0 flex-1">
            {face.kindLine !== false && (
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{workflowLabel(r.workflow_key)}</div>
            )}
            <div className="break-words text-[15px] font-semibold">
              {face.title}
            </div>
            {face.sub && <Truncated className="block text-[13px] text-muted-foreground">{face.sub}</Truncated>}
          </div>
          {face.amount && (
            <div className="shrink-0 text-right">
              <div className="font-mono text-[15px] font-semibold tabular-nums">{face.amount}</div>
              {face.amountSub && <div className="text-[11px] text-muted-foreground">{face.amountSub}</div>}
            </div>
          )}
        </div>
        {/* ONLY A FACT THAT FLAGS SOMETHING (user 2026-11-04, screenshot 4043: "1 line,
            step 1 and all no need"). A plain fact — "1 line · within budget" — told the
            approver nothing to act on and cost the card a row; an amber or red one (over
            budget, margin under the line) is exactly what they must read before Approve. */}
        {face.fact && face.factTone !== "plain" && (
        <div className="flex min-w-0 items-center gap-2">
          {face.meter && <RingMeter {...face.meter} />}
          <p
            className={cn(
              "min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[13px]",
              face.factTone === "danger"
                ? "bg-danger/10 font-medium text-danger"
                : face.factTone === "warning"
                  ? "bg-warning/10 font-medium text-warning"
                  : "bg-surface-muted",
            )}
          >
            {face.fact}
          </p>
        </div>
        )}
        <div className="flex min-w-0 items-center gap-2">
          {/* HOW LONG IT HAS WAITED, AND NOTHING ELSE — the step ("Step 1 · Managing
              Director") is who the card is FOR, which on My Approvals is the reader; the
              decision sheet still names it beside the buttons. */}
          <span className={cn("min-w-0 flex-1 text-xs", r.is_overdue ? "font-semibold text-danger" : "text-muted-foreground")}>
            {r.is_overdue ? `Overdue ${waited(r.waiting_hours)}` : waited(r.waiting_hours)}
          </span>
          {verdict && <QuickApprove row={r} verdict={verdict} />}
        </div>
      </article>
    );
  };

  /* A request's place: the steps as dots, done → here → still to come. */
  const track = (done: number, count: number, state: "now" | "ok" | "bad") => (
    <div className="flex items-center" aria-hidden>
      {Array.from({ length: Math.max(1, count) + 1 }, (_, i) => {
        // dot 0 = Submitted; dot i = step i.
        const isDone = i === 0 || i <= done;
        const isHere = state !== "ok" && i === done + 1;
        return (
          <span key={i} className="flex flex-1 items-center last:flex-none">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full border-2",
                isHere
                  ? state === "bad"
                    ? "border-danger bg-danger"
                    : "border-warning bg-warning ring-2 ring-warning/25"
                  : isDone
                    ? "border-success bg-success"
                    : "border-border bg-surface",
              )}
            />
            {i < Math.max(1, count) && <span className={cn("h-0.5 flex-1", i < done || state === "ok" ? "bg-success" : "bg-border")} />}
          </span>
        );
      })}
    </div>
  );

  const requestCard = (q: RequestRow) => {
    const fam = FAMILY[familyOf(q.workflow_key)];
    const Icon = fam.icon;
    const title = q.subject_code ?? workflowLabel(q.workflow_key);
    const back = q.status === "rejected" && (q.last_action === "reject" || q.last_action === "return");
    const word =
      q.status === "in_progress"
        ? q.is_overdue
          ? `Overdue · ${q.step_label ?? "this step"}`
          : `Waiting on ${q.step_label ?? "the approver"}`
        : q.status === "completed"
          ? "Approved"
          : q.status === "cancelled"
            ? "Cancelled"
            : back
              ? "Sent back"
              : "Rejected";
    const tone = statusTone(q.status === "in_progress" ? (q.is_overdue ? "overdue" : "pending") : q.status === "completed" ? "approved" : q.status);
    const done = q.status === "in_progress" ? q.step_order - 1 : q.status === "completed" ? q.step_count : q.step_order - 1;
    return (
      <button
        key={q.run_id}
        type="button"
        onClick={() => openTimeline(q.run_id, `${workflowLabel(q.workflow_key)} · ${title}`, hrefOf(q.workflow_key, q.subject_id))}
        className="grid w-full gap-2 rounded-xl border border-border bg-surface p-3 text-left active:bg-surface-muted"
      >
        <div className="flex items-start gap-2.5">
          {faces[q.subject_id] ? (
            <PersonAvatar name={title} person={faces[q.subject_id]} className="h-9 w-9" />
          ) : (
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", fam.well)}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{workflowLabel(q.workflow_key)}</div>
            <div className="font-mono text-[15px] font-semibold">{title}</div>
          </div>
        </div>
        {track(done, q.step_count, q.status === "in_progress" ? "now" : q.status === "completed" ? "ok" : "bad")}
        <div className="flex items-center gap-2">
          <StatusPill tone={tone}>{word}</StatusPill>
          <span className="min-w-0 flex-1 text-right text-xs text-muted-foreground">
            {q.status === "in_progress"
              ? `since ${fmtDateTime(q.started_at)}${q.waiting_hours != null ? ` · ${waited(q.waiting_hours)}` : ""}`
              : q.last_at
                ? `${fmtDateTime(q.last_at)}${q.actor_name ? ` · ${q.actor_name}` : ""}`
                : fmtDateTime(q.completed_at ?? q.started_at)}
          </span>
        </div>
        {q.last_comment && q.status !== "in_progress" && q.status !== "completed" && (
          <p className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-[13px] text-warning">&ldquo;{q.last_comment}&rdquo;</p>
        )}
      </button>
    );
  };

  const decisionCard = (d: MyDecisionItem) => {
    const fam = FAMILY[familyOf(d.workflow_key)];
    const Icon = fam.icon;
    const title = d.subject_code ?? workflowLabel(d.workflow_key);
    const word = d.action === "approve" ? "Approved" : d.action === "return" ? "Returned" : "Rejected";
    return (
      <button
        key={d.run_id}
        type="button"
        onClick={() => openTimeline(d.run_id, `${workflowLabel(d.workflow_key)} · ${title}`, hrefOf(d.workflow_key, d.subject_id))}
        className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface p-3 text-left active:bg-surface-muted"
      >
        {faces[d.subject_id] ? (
          <PersonAvatar name={title} person={faces[d.subject_id]} className="h-9 w-9" />
        ) : (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", fam.well)}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{workflowLabel(d.workflow_key)}</div>
          <div className="font-mono text-[15px] font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">
            {d.step_label ?? `Step ${d.step_order}`} · {fmtDateTime(d.acted_at)}
            {d.is_override ? " · override" : ""}
          </div>
        </div>
        <StatusPill tone={statusTone(d.action === "approve" ? "approved" : d.action === "return" ? "returned" : "rejected")}>{word}</StatusPill>
      </button>
    );
  };

  const sentList = requests.filter((q) => keep(q.workflow_key));
  const decidedList = decisions.filter((d) => keep(d.workflow_key));
  const stillWaiting = requests.filter((q) => q.status === "in_progress").length;

  return (
    <div className="min-w-0 space-y-3">
      {!allOpen && (
        <ToggleGroup<Tab>
          label="Approvals"
          role="tablist"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setFamily("all");
          }}
          className="grid w-full grid-cols-3"
          options={[
            { value: "decide", label: "To decide", count: rows.length },
            { value: "sent", label: "My requests", count: stillWaiting },
            { value: "decided", label: "Decided", count: decisions.length },
          ]}
        />
      )}

      {familyCounts.total > 0 && (
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
          <ToggleGroup<Family | "all">
            label="Type"
            value={family}
            onChange={setFamily}
            className="w-max"
            options={[
              { value: "all", label: "All", count: familyCounts.total },
              ...(Object.keys(FAMILY) as Family[])
                .filter((f) => familyCounts.m.get(f))
                .map((f) => ({ value: f, label: FAMILY[f].label, icon: FAMILY[f].icon, count: familyCounts.m.get(f) })),
            ]}
          />
        </div>
      )}

      {tab === "decide" && (
        <div className="grid grid-cols-1 gap-2">
          {overdue.length > 0 && <h3 className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-danger">Overdue</h3>}
          {overdue.map(card)}
          {waiting.length > 0 && (
            <h3 className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {allOpen ? "Open" : "Waiting on you"}
            </h3>
          )}
          {waiting.map(card)}
          {queue.length === 0 && (
            <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
              {allOpen ? "No approval is open anywhere right now." : "Nothing is waiting on you."}
            </p>
          )}
        </div>
      )}

      {tab === "sent" && (
        <div className="grid grid-cols-1 gap-2">
          {sentList.map(requestCard)}
          {sentList.length === 0 && (
            <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing you raised is in an approval.
            </p>
          )}
        </div>
      )}

      {tab === "decided" && (
        <div className="grid grid-cols-1 gap-2">
          {decidedList.map(decisionCard)}
          {decidedList.length === 0 && (
            <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
              You have not decided any approval yet.
            </p>
          )}
        </div>
      )}

      {/* THE TIMELINE — who signed, who it waits on, and the steps still to come,
          from the run's frozen steps (`approval_timeline`). A bottom sheet. */}
      <Sheet open={!!timeline} onClose={() => setTimeline(null)} title={timeline?.title ?? ""} fullScreen={false} size="sm">
        {timeline && (
          <div className="space-y-3 pb-2">
            {/* Back to the list, as on the decision sheet (user 2026-11-04: "no back option"). */}
            <BackLink onBack={() => setTimeline(null)} label="My Approvals" className="-ml-1 h-7" />
            {timeline.result === null ? (
              <p className="text-sm text-muted-foreground">Loading the history…</p>
            ) : timeline.result.ok ? (
              (() => {
                const names = timeline.result.names;
                return <ApprovalTimeline rows={timeline.result.rows} resolveUserName={(id) => names[id]} />;
              })()
            ) : (
              <p className="text-sm text-danger">{timeline.result.error}</p>
            )}
            {/* No "Open the document" link out (user 2026-11-04: everything opens here). */}
          </div>
        )}
      </Sheet>
    </div>
  );
}
