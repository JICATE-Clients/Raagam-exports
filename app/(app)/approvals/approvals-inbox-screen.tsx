"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { buttonClasses } from "@/components/ui/button";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { Sheet } from "@/components/ui/sheet";
import { FIELD_ROW } from "@/components/ui/field";
import { FigureCell, HighlightTile, signTone } from "../orders/budgets/budget-general";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { WORKFLOWS, WORKFLOW_LIST, workflowLabel } from "@/lib/approvals/workflows";
import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";
import type { BudgetKpis } from "@/lib/orders/budget/amendment";
import type { CanActVerdict, QueueItem, StrandedRun } from "@/lib/approvals/types";
import { RevisionComparePanel } from "@/components/approvals/revision-compare-panel";
import { revisionCompareAction } from "@/lib/approvals/revision-compare-actions";
import type { RevisionCompare } from "@/lib/approvals/revision-compare";

/** A queue row with the two keys `withCreators` / `withCreatedColumns` read. */
export type QueueRow = QueueItem & {
  created_at: string;
  created_by: string;
  created_by_name?: string | null;
};

/**
 * The budget behind one `order_budget` queue row, for the phone card
 * (`doc/order/newfeature.md` §2). `kpis` is `submitted_summary` read back —
 * the figures AS SUBMITTED, never recomputed here. NULL when the budget
 * predates the summary column, in which case the card names the document and
 * shows no figures rather than inventing them.
 */
export type BudgetCard = {
  code: string | null;
  currency: string | null;
  kpis: BudgetKpis | null;
  /** The budget's customers and "STYLE REF / DESCRIPTION"s, comma-joined. */
  customer: string | null;
  styles: string | null;
  /**
   * The OPEN revision entry on this budget, or null for a first submit
   * (client 2026-09-24: the MD's card names the RE, the Rev #, who raised it
   * and why). `revNo` is the register's own "Rev #n".
   */
  revision: {
    entryId: string;
    entryNo: string | null;
    revNo: number | null;
    reason: string | null;
    raisedBy: string | null;
    raisedAt: string;
  } | null;
};

/** "HO/RE/26-27/0001" — the RE No(s) a budget card leads with, else its code. */
function reOf(b: BudgetCard | undefined): string | null {
  const re = b?.kpis?.re_nos.join(", ");
  return re || b?.code || null;
}

/**
 * MY APPROVALS — every module's pending sign-offs in one queue.
 *
 * ## WHAT IS NOT HERE, ON PURPOSE
 *
 * No "approve" button. A decision needs the document in front of it — the whole
 * failure mode of a bulk-approve inbox is that it makes approving cheaper than
 * reading, and an approval nobody read is worse than no approval step at all.
 * Each row opens its document, and `<ApprovalActionBar>` decides there, where
 * the figures are.
 *
 * ## AND NO CLIENT-SIDE FILTER ON WHO MAY ACT
 *
 * `approval_my_queue` already resolved that, through the same
 * `approval_step_approvers` predicate `approval_can_act` uses. A row that is
 * here is actionable by definition. The search and workflow facets below narrow
 * what is DISPLAYED and nothing else — the skill's troubleshooting table lists
 * "badge count ≠ list length" with "you filtered the queue client-side" as the
 * cause, and that is a warning about filtering on eligibility, not on text.
 */
export function ApprovalsInboxScreen({
  rows,
  stranded,
  canViewAll,
  budgets,
  verdicts,
}: {
  rows: QueueRow[];
  stranded: StrandedRun[];
  canViewAll: boolean;
  /** Keyed by `subject_id`. Empty for every non-budget workflow. */
  budgets: Record<string, BudgetCard>;
  /** Keyed by `run_id`, and present ONLY where the server said yes. */
  verdicts: Record<string, CanActVerdict>;
}) {
  const [query, setQuery] = useState("");
  const [workflow, setWorkflow] = useState("");
  /**
   * WHICH CARD IS OPEN ON THE PHONE. A run id, never a row object — the page
   * re-renders after a decision (`router.refresh()` inside the action bar) and
   * a held row would be a stale copy of something that has just moved on.
   */
  const [decideOn, setDecideOn] = useState<string | null>(null);
  /**
   * THE OPEN REVISION'S LAST-vs-LATEST, keyed by the entry it is for. Fetched
   * by the TAP that opens the sheet — an event, not an effect — and dropped
   * if the MD has moved on to another card before it answers. `result: null`
   * is "still working it out".
   */
  const [compare, setCompare] = useState<{ entryId: string; result: RevisionCompare | null } | null>(null);
  const openDecision = (r: QueueRow) => {
    setDecideOn(r.run_id);
    const rev = budgets[r.subject_id]?.revision;
    if (!rev || compare?.entryId === rev.entryId) return;
    setCompare({ entryId: rev.entryId, result: null });
    revisionCompareAction(rev.entryId)
      .catch((): RevisionCompare => ({ ok: false, refused: "The comparison could not be loaded" }))
      .then((result) => setCompare((c) => (c?.entryId === rev.entryId ? { entryId: rev.entryId, result } : c)));
  };

  /**
   * HOW MANY SIT UNDER EACH WORKFLOW — the counts, in the facet, exactly as
   * Material BOM's status facet carries them (AGENTS.md's reference for this
   * shape). A list of workflows that says nothing about whether any rows are in
   * them cannot answer "is anything waiting on Purchase?" except by choosing it
   * and looking at an empty table.
   *
   * Derived from the rows rather than declared, so a workflow key built by hand
   * — one absent from `WORKFLOWS` — still appears here rather than becoming
   * unreachable. `workflowLabel` prints the raw key for those.
   */
  const workflowCounts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const w of WORKFLOW_LIST) seen.set(w.key, 0);
    for (const r of rows) seen.set(r.workflow_key, (seen.get(r.workflow_key) ?? 0) + 1);
    return [...seen.entries()].map(([key, count]) => ({ key, count }));
  }, [rows]);

  /** The row the phone sheet is open on, re-read from `rows` every render so a
   *  decision that refreshes the page cannot leave a stale copy on screen. */
  const decideRow = decideOn ? (rows.find((r) => r.run_id === decideOn) ?? null) : null;
  const decideVerdict = decideRow ? (verdicts[decideRow.run_id] ?? null) : null;
  /** The open card's stored figures. NULL for a non-budget workflow, and for a
   *  budget submitted before `submitted_summary` existed. */
  const kpis = decideRow ? (budgets[decideRow.subject_id]?.kpis ?? null) : null;
  const decideCard = decideRow ? budgets[decideRow.subject_id] : undefined;
  const decideRevision = decideCard?.revision ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (workflow && r.workflow_key !== workflow) return false;
      if (!needle) return true;
      return [workflowLabel(r.workflow_key), r.step_label, r.created_by_name ?? ""]
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [rows, query, workflow]);

  /**
   * WHERE A ROW OPENS.
   *
   * `WORKFLOWS` knows the route per workflow key; a key it does not know has no
   * href, and the row renders as plain text rather than as a link to nowhere. A
   * dead link in a work queue is worse than no link: it reads as a broken screen
   * rather than as a workflow nobody has finished wiring.
   */
  /* `:id` is the subject — the same substitution notify.ts and sla.ts make.
     Unreplaced, IWO Budget and Staff Fine rows linked to `?open=:id` and
     opened nothing. */
  const hrefFor = (r: QueueRow) =>
    WORKFLOWS[r.workflow_key as keyof typeof WORKFLOWS]?.href.replace(":id", r.subject_id) ?? null;

  /** "3d 4h" — a queue is read for how LONG something has waited, not for when
   *  it arrived, and the Created Date column already carries the when. */
  const waited = (hours: number) => {
    if (hours < 1) return "under an hour";
    if (hours < 24) return `${Math.floor(hours)}h`;
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    return h ? `${d}d ${h}h` : `${d}d`;
  };

  const columns: Column<QueueRow>[] = [
    {
      header: "Document",
      cell: (r) => {
        const href = hrefFor(r);
        const label = workflowLabel(r.workflow_key);
        return href ? (
          <Link href={href} className="text-xs font-medium text-primary hover:underline">
            {label}
          </Link>
        ) : (
          <span className="text-xs font-medium">{label}</span>
        );
      },
    },
    {
      header: "Waiting on you for",
      cell: (r) => (
        /* AMBER PAST A WEEK, and nothing before it. A colour on every row is a
           colour on none — the same argument `DaysOut` makes for going silent
           beyond 60 days on a delivery date.

           RED PAST ITS DEADLINE (0601), which outranks the week: an agreed SLA
           of two hours is a stronger claim than a rule of thumb about a week,
           and a request the business said it would answer by 4pm is late at
           4pm whether or not it has been sitting for seven days. */
        <span
          className={
            r.is_overdue
              ? "text-sm font-semibold text-danger"
              : r.waiting_hours >= 168
                ? "text-sm font-medium text-warning"
                : "text-sm text-muted-foreground"
          }
        >
          {waited(r.waiting_hours)}
          {r.is_overdue ? " · overdue" : ""}
        </span>
      ),
    },
    {
      header: "Step",
      cell: (r) => (
        <span className="text-sm">
          <span className="text-muted-foreground">{r.step_order}. </span>
          <Truncated>{r.step_label}</Truncated>
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) =>
        r.is_overdue ? (
          <StatusPill tone="danger">Overdue</StatusPill>
        ) : (
          <StatusPill tone="warning">Awaiting you</StatusPill>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Approvals"
        description="Every request across the business that is waiting on your decision."
        actions={
          /* A LINK, NOT A BUTTON WRAPPING ONE. Raagam's `Button` renders a real
             <button> and takes no `asChild`, so nesting an <a> inside it is
             invalid markup — the same nesting rule `MobileCardList` is shaped
             around. `buttonClasses` gives the link the header row's `md` (h-9)
             height, which is what the toolbar-size rule asks of every control
             in this band. */
          canViewAll ? (
            <Link href="/approvals/flows" className={buttonClasses({ variant: "outline", size: "md" })}>
              Approval Flows
            </Link>
          ) : undefined
        }
      />

      {/* THE STRANDED BANNER — an incident, not a report.
          A run whose current step resolves to NOBODY raises no error and sits
          for months; the skill records it as the single highest-cost defect in
          the system this engine was extracted from, and `approval_start_run`
          exists to make it impossible by refusing at the start. So a non-empty
          result here means something changed AFTER a run began — a role was
          revoked, an approver deactivated — and it is the one thing on this
          screen that needs a person rather than a decision.

          Shown only to someone holding `approvals:view`: an ordinary approver is
          by definition not on a stranded step and can do nothing about it. */}
      {stranded.length > 0 && (
        <div className="rounded-md border-2 border-danger/40 bg-danger/5 p-3">
          <p className="text-sm font-semibold text-danger">
            {fmtNumber(stranded.length)}{" "}
            {stranded.length === 1 ? "request has" : "requests have"} no eligible
            approver
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Their current step resolves to nobody, so they are in no one&rsquo;s queue
            and no one is being asked. Assign the role the step names, or cancel the
            run.
          </p>
          <ul className="mt-2 space-y-1">
            {stranded.map((s) => (
              <li key={s.run_id} className="text-xs">
                <span className="font-medium">{workflowLabel(s.workflow_key)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · step {s.current_step}
                  {s.step_label ? ` (${s.step_label})` : ""} · stuck {s.age}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search document, step or requester…"
        activeCount={workflow ? 1 : 0}
        onReset={workflow ? () => setWorkflow("") : undefined}
        right={`${filtered.length} of ${rows.length}`}
      >
        <div>
          <Label htmlFor="approval-workflow">Document</Label>
          <Select
            id="approval-workflow"
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
          >
            <option value="">All ({rows.length})</option>
            {workflowCounts.map((w) => (
              <option key={w.key} value={w.key} disabled={w.count === 0 && w.key !== workflow}>
                {workflowLabel(w.key)} ({w.count})
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {/* The Created pair is the requester and when they raised it — mapped onto
          `created_at` / `created_by` in the page so the app's one helper renders
          them (see the note there). `withCreatedColumns` self-hides if a future
          change stops supplying them, so this cannot decay into a dash column.

          `hidden md:block` — the phone gets the card list below instead. */}
      <div className="hidden md:block">
        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(r) => r.run_id}
          empty="Nothing is waiting on you. Requests appear here the moment a step names you as an approver."
        />
      </div>

      {/**
        * THE EXECUTIVE MOBILE VIEW — `doc/order/newfeature.md` §2.
        *
        * "Approvers (MD / Factory Managers) view high-level budget metrics
        * (Order Qty, Gross Sales, Total Expenses, Profit %, Profit Value) in a
        * clean card format", with "one-tap actions: Approve, Not Approved, or
        * Rework (with mandatory notes)".
        *
        * ## THE INBOX'S "NO APPROVE BUTTON" RULE IS KEPT, NOT WAIVED
        *
        * This file's header says there is no approve button because "the whole
        * failure mode of a bulk-approve inbox is that it makes approving
        * cheaper than reading, and an approval nobody read is worse than no
        * approval step at all". That rule is about deciding WITHOUT THE
        * FIGURES, and it is honoured exactly: the card carries the budget's own
        * submitted totals, and the decision is made in a sheet that shows them
        * again beside the buttons. What is still absent — deliberately — is a
        * tick on the row itself, and any way to act on several at once.
        *
        * On a phone the alternative is worse for the same reason: a link out to
        * a desktop table means the MD approves from a screen they cannot read,
        * or does not approve at all.
        *
        * ## `md:hidden` LIVES HERE, AT THE CALL SITE
        *
        * `MobileCardList`'s own header asks for that, so a caller wanting cards
        * at every width simply omits the wrapper.
        */}
      <div className="md:hidden">
        <MobileCardList<QueueRow>
          rows={filtered}
          getKey={(r) => r.run_id}
          /* A BUDGET CARD LEADS WITH ITS RE NO (client 2026-09-24) — the number
             the MD knows the order by — then the customer and style under it.
             Every other workflow keeps its label. */
          title={(r) =>
            budgets[r.subject_id] ? (
              <span className="font-mono">{reOf(budgets[r.subject_id]) ?? workflowLabel(r.workflow_key)}</span>
            ) : (
              workflowLabel(r.workflow_key)
            )
          }
          subtitle={(r) => {
            const b = budgets[r.subject_id];
            if (!b) return null;
            const line = [b.customer, b.styles].filter(Boolean).join(" · ");
            return line ? <Truncated>{line}</Truncated> : b.code;
          }}
          pill={(r) => {
            /* "REV #2 · PENDING" — a revision says which one, in the pill the
               queue already reads for state. */
            const rev = budgets[r.subject_id]?.revision;
            const word = r.is_overdue ? "Overdue" : rev ? "Pending" : "Awaiting you";
            return (
              <StatusPill tone={r.is_overdue ? "danger" : "warning"}>
                {rev?.revNo ? `Rev #${rev.revNo} · ${word}` : word}
              </StatusPill>
            );
          }}
          meta={(r) =>
            `${budgets[r.subject_id] ? `${workflowLabel(r.workflow_key)} · ` : ""}Step ${r.step_order} · ${r.step_label} · waiting ${waited(r.waiting_hours)}`
          }
          stats={(r) => cardStats(budgets[r.subject_id])}
          /* TAP THE CARD TO DECIDE. `onEdit` is the primitive's tap slot; the
             word is historical (it opens a record) and this opens the sheet
             that holds the figures and the three buttons. A card with no
             verdict is not tappable at all rather than opening a sheet with
             nothing in it — see `queueVerdicts` in the page for when that
             happens. */
          onEdit={(r) => (verdicts[r.run_id] ? openDecision(r) : undefined)}
          /* WHO RAISED IT, AND WHEN — for a revision, the merchandiser who
             raised the ENTRY and the time they did; otherwise the requester. */
          footerNote={(r) => {
            const rev = budgets[r.subject_id]?.revision;
            if (rev) return `Raised by ${rev.raisedBy ?? r.created_by_name ?? "—"} · ${fmtDateTime(rev.raisedAt)}`;
            return r.created_by_name ? `Raised by ${r.created_by_name} · ${fmtDateTime(r.started_at)}` : null;
          }}
          empty="Nothing is waiting on you. Requests appear here the moment a step names you as an approver."
        />
      </div>

      {/* THE DECISION, WITH THE FIGURES STILL ON SCREEN. */}
      {decideRow && decideVerdict && (
        <Sheet
          open
          onClose={() => setDecideOn(null)}
          title={
            decideRevision
              ? `${reOf(decideCard) ?? "Revision"}${decideRevision.revNo ? ` · Rev #${decideRevision.revNo}` : ""}`
              : decideCard?.code
                ? `${workflowLabel(decideRow.workflow_key)} · ${decideCard.code}`
                : workflowLabel(decideRow.workflow_key)
          }
        >
          <div className="space-y-4 p-4">
            {/* A REVISION IS DECIDED ON LAST vs LATEST (client 2026-09-24) — who
                raised it and why, the P&L both ways, and the cost heads that
                moved. The submitted totals below still follow: they are the
                figures the run froze, the same ones the push carried. */}
            {decideRevision && (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd>{decideCard?.customer ?? "—"}</dd>
                  <dt className="text-muted-foreground">Style</dt>
                  <dd>{decideCard?.styles ?? "—"}</dd>
                  <dt className="text-muted-foreground">Revision</dt>
                  <dd className="font-mono">{decideRevision.entryNo ?? "—"}</dd>
                  <dt className="text-muted-foreground">Raised by</dt>
                  <dd>
                    {decideRevision.raisedBy ?? decideRow.created_by_name ?? "—"} ·{" "}
                    {fmtDateTime(decideRevision.raisedAt)}
                  </dd>
                </dl>
                <RevisionComparePanel
                  state={compare?.entryId === decideRevision.entryId ? compare.result : null}
                />
                <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
                  <span className="font-semibold">Reason for revision: </span>
                  {decideRevision.reason ?? <span className="text-muted-foreground">None given</span>}
                </div>
                <Link
                  href={`/orders/order-amendments/${decideRevision.entryId}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open the full revision (every line, Original Budget, what changed)
                </Link>
              </>
            )}
            {/**
              * THE SAME COMPONENTS THE DESKTOP APPROVAL SCREEN USES.
              *
              * `HighlightTile` carries its own comment saying it is exported
              * "for the approval sheet, which shows the same bottom line and
              * must read the same way" — this is that sheet, on a phone. Two
              * renderings of one set of figures is how a profit reads green in
              * one place and plain in another, and an MD approving from the
              * phone must be reading exactly what the desktop shows.
              *
              * `FIELD_ROW` rather than a `grid-cols-*` of this screen's own:
              * the layout skill's governing rule, and `--check screen-grid`
              * flags the alternative.
              */}
            {kpis ? (
              <>
                <dl className="flex flex-wrap items-stretch gap-2.5">
                  <HighlightTile w="code" tone="sales" label="Gross sales" value={kpis.total_income} />
                  <HighlightTile w="code" tone="plain" label="Total expenses" value={kpis.total_expenses} />
                  <HighlightTile
                    w="code"
                    tone={signTone(kpis.profit)}
                    label="Profit / loss"
                    value={kpis.profit}
                  />
                  <HighlightTile
                    w="hug"
                    tone={signTone(kpis.profit)}
                    label="Profit %"
                    value={kpis.profit_pct}
                    suffix="%"
                  />
                </dl>
                <dl className={FIELD_ROW}>
                  <FigureCell w="code" label="Order qty" value={kpis.order_qty} />
                  <FigureCell w="code" label="Cost per piece" value={kpis.cost_per_piece} />
                  <FigureCell w="term" label="RE No" value={kpis.re_nos.join(", ")} />
                  <FigureCell
                    w="term"
                    label="Delivery"
                    value={kpis.delivery_dates.map((d) => fmtDate(d)).join(", ")}
                  />
                </dl>
              </>
            ) : (
              /* NO SUMMARY = a budget submitted before the column existed. It
                 says so rather than showing nothing, because a sheet with three
                 buttons and no figures reads as a screen that failed to load —
                 and an approver would be right not to trust it. */
              <p className="text-xs text-muted-foreground">
                No submitted summary was stored for this document. Open it on a desktop
                to read the figures before deciding.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Step {decideVerdict.step_order} · {decideVerdict.step_label}. Returning
              for changes and rejecting both need a reason.
            </p>

            {/* The same bar the desktop document page mounts — one decision
                path, one `lock_version` rule, one set of words. `run` is built
                from the queue row: a row IS a fresh read, which is the one
                thing that field requires (see `ActionBarRun`). */}
            <ApprovalActionBar
              run={{
                id: decideRow.run_id,
                lock_version: decideRow.lock_version,
                status: "in_progress",
              }}
              verdict={decideVerdict}
              subjectPath="/approvals"
            />
          </div>
        </Sheet>
      )}
    </div>
  );
}

/**
 * THE FIVE FIGURES §2 NAMES, AND NOTHING ELSE.
 *
 * Profit VALUE leads: it is the number an approval is actually about, and the
 * primitive draws a lead stat at ~1.5× the rest so a thumb scrolling the queue
 * lands on it. Profit % rides beside it because a healthy value on a huge order
 * and a thin one read identically without it.
 *
 * A REFUSAL PRINTS ITS SENTENCE. `budgetFiguresOf` returns `{refused}` rather
 * than 0 when a figure cannot be worked out (an unpriced line, a pending
 * percent), and `CardStat.value` is a node precisely so that sentence can go
 * where the number would — never a dash, and never a zero an MD might approve.
 */
function cardStats(b: BudgetCard | undefined): CardStat[] {
  const k = b?.kpis;
  if (!k) return [];
  const money = (v: number | Refusal) =>
    isRefusal(v) ? (
      <span className="text-xs font-normal text-warning">{v.refused}</span>
    ) : (
      fmtNumber(v)
    );

  return [
    { label: "Order qty", value: money(k.order_qty) },
    {
      label: "Delivery",
      value: k.delivery_dates.length ? k.delivery_dates.map((d) => fmtDate(d)).join(", ") : "—",
    },
    { label: "Gross sales", value: money(k.total_income) },
    { label: "Expenses", value: money(k.total_expenses) },
    { label: "Profit", value: money(k.profit), lead: true },
    {
      label: "Profit %",
      value: isRefusal(k.profit_pct) ? (
        <span className="text-xs font-normal text-warning">{k.profit_pct.refused}</span>
      ) : (
        `${fmtNumber(k.profit_pct)}%`
      ),
    },
  ];
}
