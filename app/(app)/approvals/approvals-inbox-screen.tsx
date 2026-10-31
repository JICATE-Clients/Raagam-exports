"use client";

import { useMemo, useState, type ReactNode } from "react";
import { StatusMark } from "@/components/ui/status-mark";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { buttonClasses } from "@/components/ui/button";
import { fmtDate, fmtDateTime, fmtFixed, fmtNumber } from "@/lib/format";
import { Sheet } from "@/components/ui/sheet";
import { FIELD_ROW } from "@/components/ui/field";
import { FigureCell, HighlightTile, signTone } from "../orders/budgets/budget-general";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { WORKFLOWS, WORKFLOW_LIST, workflowLabel } from "@/lib/approvals/workflows";
import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";
import type { CanActVerdict, QueueItem, StrandedRun } from "@/lib/approvals/types";
import { RevisionComparePanel } from "@/components/approvals/revision-compare-panel";
import { revisionCompareAction } from "@/lib/approvals/revision-compare-actions";
import type { RevisionCompare } from "@/lib/approvals/revision-compare";
import { BudgetBreakdownChart } from "@/components/orders/budget-breakdown-chart";
import type { OrderApprovalCard as OrderCardData } from "@/lib/approvals/order-approval-cards";
import { OrderApprovalCard } from "@/components/approvals/order-approval-card";
import type { PoApprovalCard, PoChangeCard } from "@/lib/approvals/po-approval-cards";
import { approvePo, declinePo } from "@/lib/purchase/po-actions";
import { ClipboardCheck } from "lucide-react";
import { RowIconAction } from "@/components/ui/row-actions";

/** A queue row with the two keys `withCreators` / `withCreatedColumns` read. */
export type QueueRow = QueueItem & {
  created_at: string;
  created_by: string;
  created_by_name?: string | null;
  /** "All open" only (0783): who the step waits on, and the document's unit. */
  approver_names?: string[];
  unit_name?: string | null;
};

/**
 * The ORDER behind one `order_budget` queue row, for the phone card — one
 * shape with the desktop register, assembled once by `loadOrderApprovalCards`
 * (RE No, customer, style, qty, earliest shipment, merchandiser, submitter,
 * revision, and the cost breakdown with V0). `kpis` is `submitted_summary`
 * read back — the figures AS SUBMITTED, never recomputed. NULL when the budget
 * predates the summary column: the card names the document and shows no
 * figures rather than inventing them.
 */
export type BudgetCard = OrderCardData;

/** "HO/RE/26-27/0001" — the RE No(s) a budget card leads with, else its code. */
function reOf(b: BudgetCard | undefined): string | null {
  const re = b?.reNos.join(", ");
  return re || b?.budgetCode || null;
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
  pos = {},
  poChanges = {},
  verdicts,
  viewToggle,
  allOpen = false,
}: {
  /**
   * SUPER ADMIN ▸ ALL OPEN (0783) — the SAME screen over every open run, decided
   * here and never by a link out (user 2026-10-31, screenshot 3941: "don't
   * redirect … approve, reject all in same screen"). Adds Waiting on and Unit.
   */
  allOpen?: boolean;
  /** The super admin's Mine / All open switch, drawn in the header row. */
  viewToggle?: ReactNode;
  rows: QueueRow[];
  stranded: StrandedRun[];
  canViewAll: boolean;
  /** Keyed by `subject_id`. Empty for every non-budget workflow. */
  budgets: Record<string, BudgetCard>;
  /** Purchase Orders (0764), keyed by `subject_id` — total, variance, profit impact. */
  pos?: Record<string, PoApprovalCard>;
  /** PO rate amendments and PO cancellations (0785), keyed by `subject_id`. */
  poChanges?: Record<string, PoChangeCard>;
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
  /* THE COST BREAKDOWN ARRIVES WITH THE CARD (Phase 2, 2026-09-30) —
     `loadOrderApprovalCards` computes it with the queue, so the tap that
     opens the sheet no longer waits on a second action for it. */
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
  const decidePo = decideRow ? pos[decideRow.subject_id] : undefined;
  const decideChange = decideRow ? poChanges[decideRow.subject_id] : undefined;
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
      className: HUG,
      cell: (r) => {
        const href = hrefFor(r);
        const po = pos[r.subject_id];
        const chg = poChanges[r.subject_id];
        // A PO names itself and what it costs the order (0764).
        const label = po?.code ? `PO ${po.code}` : chg ? changeTitle(chg) : workflowLabel(r.workflow_key);
        /* DECIDED HERE, NOT ON THE DOCUMENT'S PAGE (user 2026-10-31): a row
           this user may act on opens the decision sheet in place; the sheet
           still carries the link to the full document. A row with no verdict
           keeps its link, because there is nothing to decide here. */
        const link = verdicts[r.run_id] ? (
          <button
            type="button"
            onClick={() => openDecision(r)}
            className="text-left text-xs font-medium text-primary hover:underline"
          >
            {label}
          </button>
        ) : href ? (
          <Link href={href} className="text-xs font-medium text-primary hover:underline">
            {label}
          </Link>
        ) : (
          <span className="text-xs font-medium">{label}</span>
        );
        /* THE DETAIL LINE WRAPS, capped at 22rem (user 2026-10-31: "without
           scrolling fit compact") — on one line it was the widest thing in the
           table and pushed every other column off the pane. */
        const detail = (text: string) => (
          <span className="block max-w-[22rem] text-[11px] leading-snug text-muted-foreground tabular-nums">{text}</span>
        );
        if (chg) {
          return (
            <span className="flex flex-col">
              {link}
              {detail(changeLine(chg))}
            </span>
          );
        }
        if (!po) return link;
        return (
          <span className="flex flex-col">
            {link}
            {detail([po.vendor, po.total, poImpactLine(po)].filter(Boolean).join(" · "))}
          </span>
        );
      },
    },
    /* STEP AND WHO IT WAITS ON ARE ONE COLUMN (2026-10-31, fit without
       scrolling): the step's role on the first line, the people holding it under
       it. On Mine the second line is you, so it is left off. */
    {
      header: allOpen ? "Step · Waiting on" : "Step",
      className: HUG,
      cell: (r) => (
        <span className="flex flex-col">
          {/* ONE LINE: "1." and the label used to break apart (screenshot 3943). */}
          <span className="flex items-baseline gap-1 whitespace-nowrap text-sm">
            <span className="shrink-0 text-muted-foreground">{r.step_order}.</span>
            <Truncated>{r.step_label}</Truncated>
          </span>
          {allOpen &&
            (r.approver_names?.length ? (
              <span className="text-[11px] text-muted-foreground">{r.approver_names.join(", ")}</span>
            ) : (
              <span className="text-[11px] font-medium text-danger">Nobody holds this step</span>
            ))}
        </span>
      ),
    },
    ...(allOpen
      ? ([
          {
            header: "Unit",
            className: HUG,
            cell: (r) => <span className="whitespace-nowrap text-sm">{r.unit_name ?? "—"}</span>,
          },
        ] satisfies Column<QueueRow>[])
      : []),
    /* STATUS CARRIES HOW LONG IT HAS WAITED (2026-10-31, one column fewer).
       The time keeps its colour rules: RED past the SLA deadline (0601), AMBER
       past a week, quiet before that — a colour on every row is a colour on none. */
    {
      header: "Status",
      className: HUG,
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5">
          {r.is_overdue ? (
            <StatusPill tone="danger">Overdue</StatusPill>
          ) : (
            <StatusPill tone="warning">{allOpen ? "Awaiting" : "Awaiting you"}</StatusPill>
          )}
          <span
            className={
              r.is_overdue
                ? "whitespace-nowrap text-[11px] font-semibold text-danger"
                : r.waiting_hours >= 168
                  ? "whitespace-nowrap text-[11px] font-medium text-warning"
                  : "whitespace-nowrap text-[11px] text-muted-foreground"
            }
          >
            waiting {waited(r.waiting_hours)}
          </span>
        </span>
      ),
    },
    /* REVIEW & DECIDE ON DESKTOP TOO (user 2026-10-31: they work on the desktop
       table). Opens the same decision sheet the phone card does — the figures
       beside the buttons — so the file's rule stands: no tick on the row, no bulk
       action. EVERY row with a verdict opens it (user 2026-10-31: "approve,
       reject all in same screen") — a workflow with no figures card still gets
       its step, requester and the three buttons, plus the link to the document. */
    {
      header: "Decide",
      className: HUG,
      cell: (r) =>
        verdicts[r.run_id] ? (
          <RowIconAction
            label="Review & decide"
            name={pos[r.subject_id]?.code ? `PO ${pos[r.subject_id].code}` : undefined}
            icon={ClipboardCheck}
            onClick={() => openDecision(r)}
          />
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Approvals"
        description={
          allOpen
            ? "Every open request in every unit — decide any of them here (recorded as an override where you are not the step's approver)."
            : "Every request across the business that is waiting on your decision."
        }
        actions={
          /* A LINK, NOT A BUTTON WRAPPING ONE. Raagam's `Button` renders a real
             <button> and takes no `asChild`, so nesting an <a> inside it is
             invalid markup — the same nesting rule `MobileCardList` is shaped
             around. `buttonClasses` gives the link the header row's `md` (h-9)
             height, which is what the toolbar-size rule asks of every control
             in this band. */
          /* THE MINE / ALL OPEN SWITCH SITS IN THIS ROW (user 2026-10-31,
             screenshot 3940: on its own row above the search it read as a stray
             control). Only a super admin is handed one. */
          viewToggle || canViewAll ? (
            <div className="flex items-center gap-2">
              {viewToggle}
              {canViewAll && (
                <Link href="/approvals/flows" className={buttonClasses({ variant: "outline", size: "md" })}>
                  Approval Flows
                </Link>
              )}
            </div>
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

          `hidden md:block` — the phone gets the card list below instead.
          FULL WIDTH since 2026-10-16 (user: Sample Entry's table everywhere). WAS
          `w-fit max-w-full` — as wide as its columns, not the pane
          (erp-table-fit skill, client 2026-09-28). */}
      <div className="hidden md:block">
        <DataTable
          columns={hugCreated(withCreatedColumns(columns, filtered))}
          rows={filtered}
          getKey={(r) => r.run_id}
          empty={allOpen ? "No approval is open anywhere right now." : "Nothing is waiting on you. Requests appear here the moment a step names you as an approver."}
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
      <div className="space-y-3 md:hidden">
        {/* AN ORDER BUDGET IS AN ORDER CARD, WITH THE DECISION ON IT (client
            2026-09-29, "MD Approval Screen in Mobile View"): the order, the
            cost bar, the margin against the 15% line, V0 vs the proposal per
            piece, and Approve · Request Rework — decided from the queue
            without opening anything. "View full sheet" still opens the
            revision detail below. Every other workflow keeps the list card. */}
        {filtered
          .filter((r) => budgets[r.subject_id])
          .map((r) => (
            <OrderApprovalCard
              key={r.run_id}
              card={budgets[r.subject_id]}
              waited={waited(r.waiting_hours)}
              overdue={r.is_overdue}
              onOpenSheet={verdicts[r.run_id] ? () => openDecision(r) : undefined}
              actions={
                verdicts[r.run_id] ? (
                  <ApprovalActionBar
                    run={{ id: r.run_id, lock_version: r.lock_version, status: "in_progress" }}
                    verdict={verdicts[r.run_id]}
                    subjectPath="/approvals"
                    rework
                    compact
                  />
                ) : undefined
              }
            />
          ))}
        {(filtered.some((r) => !budgets[r.subject_id]) || filtered.length === 0) && (
        <MobileCardList<QueueRow>
          rows={filtered.filter((r) => !budgets[r.subject_id])}
          getKey={(r) => r.run_id}
          /* A BUDGET CARD LEADS WITH ITS RE NO (client 2026-09-24) — the number
             the MD knows the order by — then the customer and style under it.
             Every other workflow keeps its label. */
          title={(r) =>
            pos[r.subject_id]?.code ? (
              <span className="font-mono">PO {pos[r.subject_id].code}</span>
            ) : poChanges[r.subject_id] ? (
              <span className="font-mono">{changeTitle(poChanges[r.subject_id])}</span>
            ) : budgets[r.subject_id] ? (
              <span className="font-mono">{reOf(budgets[r.subject_id]) ?? workflowLabel(r.workflow_key)}</span>
            ) : (
              workflowLabel(r.workflow_key)
            )
          }
          subtitle={(r) => {
            const po = pos[r.subject_id];
            if (po) return po.vendor ? <Truncated>{po.vendor}</Truncated> : null;
            const chg = poChanges[r.subject_id];
            if (chg) return <Truncated>{changeLine(chg)}</Truncated>;
            const b = budgets[r.subject_id];
            if (!b) return null;
            const line = [b.customer, b.styles].filter(Boolean).join(" · ");
            return line ? <Truncated>{line}</Truncated> : b.budgetCode;
          }}
          pill={(r) => {
            /* "REV #2 · PENDING" — a revision says which one, in the pill the
               queue already reads for state. */
            const rev = budgets[r.subject_id]?.revision;
            const word = r.is_overdue ? "Overdue" : rev ? "Pending" : "Awaiting you";
            // An ICON on the card, the words in its tooltip (components/ui/status-mark.tsx).
            return <StatusMark word={rev?.revNo ? `Rev #${rev.revNo} · ${word}` : word} mark="todo" tone={r.is_overdue ? "danger" : "warning"} />;
          }}
          meta={(r) =>
            `${budgets[r.subject_id] ? `${workflowLabel(r.workflow_key)} · ` : ""}Step ${r.step_order} · ${r.step_label} · waiting ${waited(r.waiting_hours)}`
          }
          stats={(r) =>
            pos[r.subject_id]
              ? poStats(pos[r.subject_id])
              : poChanges[r.subject_id]
                ? changeStats(poChanges[r.subject_id])
                : cardStats(budgets[r.subject_id])
          }
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
          empty={allOpen ? "No approval is open anywhere right now." : "Nothing is waiting on you. Requests appear here the moment a step names you as an approver."}
        />
        )}
      </div>

      {/* THE DECISION, WITH THE FIGURES STILL ON SCREEN. */}
      {decideRow && decideVerdict && (
        <Sheet
          open
          onClose={() => setDecideOn(null)}
          /* A CENTRED CARD, NOT A FULL-SCREEN TAKEOVER, now that desktop opens it
             too ("Review & decide", 2026-10-31). Same shape as the bar's own
             confirm: figures and three buttons need a card's width, not a page. */
          size="sm"
          alignToPane
          title={
            decideRevision
              ? `${reOf(decideCard) ?? "Revision"}${decideRevision.revNo ? ` · Rev #${decideRevision.revNo}` : ""}`
              : decideCard?.budgetCode
                ? `${workflowLabel(decideRow.workflow_key)} · ${decideCard.budgetCode}`
                : decidePo?.code
                  ? `PO ${decidePo.code}`
                  : decideChange
                    ? changeTitle(decideChange)
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
            {/* THE CHART BEFORE THE FIGURES AND THE BUTTONS (client 2026-09-29):
                where the sales go, and on a revision how that moved since V0 —
                read before Approve / Request Rework, not after. */}
            {decideCard && decideRow && (
              <div className="rounded-md border border-border bg-surface p-3">
                {(() => {
                  const res = decideCard.breakdown;
                  if (!res.ok) return <p className="text-sm text-warning">Breakdown unavailable — {res.refused}</p>;
                  return <BudgetBreakdownChart current={res.current} original={res.original} />;
                })()}
              </div>
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
            {/* A PURCHASE ORDER (0764): the money, the lines above or without a budget,
                what they cost the order, and the Purchase Manager's reason — then the
                PO itself, one tap away, for every line. */}
            {decideChange ? (
              <PoChangeDetail card={decideChange} href={hrefFor(decideRow)} />
            ) : decidePo ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Vendor</dt>
                  <dd>{decidePo.vendor ?? "—"}</dd>
                  <dt className="text-muted-foreground">Taxable</dt>
                  <dd className="tabular-nums">{decidePo.taxable}</dd>
                  <dt className="text-muted-foreground">GST</dt>
                  <dd className="tabular-nums">
                    {decidePo.gst}
                    {decidePo.gstSplit.length
                      ? ` (${decidePo.gstSplit.map((g) => `${g.label} ${g.amount}`).join(" · ")})`
                      : ""}
                  </dd>
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="font-semibold tabular-nums">{decidePo.total}</dd>
                  <dt className="text-muted-foreground">Delivery</dt>
                  <dd className="tabular-nums">{decidePo.deliveryDate ? fmtDate(decidePo.deliveryDate) : "—"}</dd>
                  <dt className="text-muted-foreground">Lines</dt>
                  <dd className="tabular-nums">
                    {decidePo.lineCount}
                    {decidePo.overCount != null ? ` · ${decidePo.overCount} above budget` : ""}
                    {decidePo.unbudgetedCount ? ` · ${decidePo.unbudgetedCount} without a budget` : ""}
                  </dd>
                  <dt className="text-muted-foreground">Profit impact</dt>
                  <dd className={decidePo.profitHit ? "font-semibold text-danger tabular-nums" : "tabular-nums"}>
                    {poImpactLine(decidePo) ?? "—"}
                  </dd>
                </dl>
                {/* EACH LINE OVER ITS BUDGET (user 2026-10-31) — typed rate incl. GST vs
                    the ceiling, both in rupees, straight from `poBudgetImpact`. Five at
                    most; the PO page carries every line. */}
                {decidePo.overLines?.length ? (
                  <div className="rounded-md border border-danger/30 bg-danger/5 p-2.5 text-xs">
                    <p className="font-semibold text-danger">
                      Approving this PO reduces order net profit by ₹ {fmtFixed(decidePo.profitHit ?? 0, 2)}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {decidePo.overLines.slice(0, 5).map((l, i) => (
                        <li key={i} className="flex items-baseline gap-2">
                          <Truncated className="min-w-0 flex-1">{l.item}</Truncated>
                          <span className="shrink-0 tabular-nums">
                            ₹ {rateText(l.rate)} <span className="text-muted-foreground">vs budget ₹ {rateText(l.budget)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {decidePo.overLines.length > 5 ? (
                      <p className="mt-1 text-muted-foreground">+{decidePo.overLines.length - 5} more on the PO</p>
                    ) : null}
                  </div>
                ) : null}
                <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
                  <span className="font-semibold">Reason: </span>
                  {decidePo.reason ?? <span className="text-muted-foreground">None given</span>}
                </div>
                {hrefFor(decideRow) ? (
                  <Link href={hrefFor(decideRow)!} className="text-xs font-medium text-primary hover:underline">
                    Open the PO (every line, budget vs rate)
                  </Link>
                ) : null}
              </>
            ) : kpis ? (
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
              /* An order budget reads Approve · Request Rework (client
                 2026-09-29); every other workflow keeps its three buttons. */
              rework={
                decideRow.workflow_key === WORKFLOWS.order_budget.key ||
                decideRow.workflow_key === WORKFLOWS.purchase_order.key
              }
              /* EVERY PO IS APPROVED IN ONE CLICK (user 2026-10-31, widening the
                 2026-10-30 within-budget rule) — above budget too, and on an
                 override: `approvePo` runs the signature / TBA / reopened-budget
                 gates and ends the run through `actOnSubject`, which writes the
                 override remark. Request Rework sends it back to draft; Reject
                 (`declinePo`) closes it for good and reopens the requirement.
                 Both need a reason. Non-PO workflows keep the engine's path. */
              onApprove={
                decideRow.workflow_key === WORKFLOWS.purchase_order.key
                  ? () => approvePo(decideRow.subject_id)
                  : undefined
              }
              onRejectForGood={
                decideRow.workflow_key === WORKFLOWS.purchase_order.key
                  ? (reason) => declinePo(decideRow.subject_id, reason)
                  : undefined
              }
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
/** "−₹ 12,345.00 profit (8.2% over)" — or null when nothing is above budget / unknown. */
function poImpactLine(po: PoApprovalCard): string | null {
  if (po.profitHit == null) return null;
  if (po.profitHit <= 0) return po.unbudgetedCount ? "No budget to compare" : "Within budget";
  /* Plain words, money at 2 places and the % at 1 (screenshot 3943: "−₹ 433.26
     profit (36.889% over)" after a "·" read as a double minus). */
  return `Profit down ₹ ${fmtFixed(po.profitHit, 2)} (${fmtFixed(po.overPct ?? 0, 1)}% over budget)`;
}

/** "Rate amendment · PO 123" / "Cancellation · PO 123". */
function changeTitle(c: PoChangeCard): string {
  const po = c.poCode ? `PO ${c.poCode}` : "PO";
  return c.kind === "rate" ? `Rate amendment · ${po}` : `Cancellation · ${po}`;
}

/** A signed money change: "+₹ 1,200.00" / "−₹ 300.00". */
function signedMoney(currency: string, v: number): string {
  return `${v >= 0 ? "+" : "−"}${currency} ${fmtFixed(Math.abs(v), 2)}`;
}

/** The one line under the title: what changes, in money. */
function changeLine(c: PoChangeCard): string {
  if (c.kind === "rate") {
    return [c.item, `${c.currency} ${rateText(c.previousRate)} → ${rateText(c.revisedRate)}`, signedMoney(c.currency, c.valueChange)]
      .filter(Boolean)
      .join(" · ");
  }
  const n = c.lines.length;
  return `${c.scope === "whole" ? "Whole PO" : "Part"} · ${n} line${n === 1 ? "" : "s"} · ${c.currency} ${fmtFixed(c.cancelValue, 2)}`;
}

/** The budget sentence for a rate amendment — the PO card's own words. */
function rateBudgetLine(c: Extract<PoChangeCard, { kind: "rate" }>): string {
  if (!c.hasBudget) return "No approved budget";
  if (c.budgetRate == null) return "—";
  if (!c.profitHit) return `Within budget (₹ ${rateText(c.budgetRate)} incl. GST)`;
  return `Approving this reduces order net profit by ₹ ${fmtFixed(c.profitHit, 2)}`;
}

function changeStats(c: PoChangeCard): CardStat[] {
  if (c.kind === "rate") {
    return [
      { label: "Rate", value: `${rateText(c.previousRate)} → ${rateText(c.revisedRate)}` },
      { label: "Value change", value: signedMoney(c.currency, c.valueChange) },
      { label: "Budget", value: rateBudgetLine(c), lead: true },
    ];
  }
  return [
    { label: "Scope", value: c.scope === "whole" ? "Whole PO" : "Part" },
    { label: "Lines", value: String(c.lines.length) },
    { label: "Cancelled value", value: `${c.currency} ${fmtFixed(c.cancelValue, 2)}`, lead: true },
  ];
}

/** The decision sheet's body for a rate amendment or a cancellation (0785). */
function PoChangeDetail({ card: c, href }: { card: PoChangeCard; href: string | null }) {
  return (
    <>
      {c.kind === "rate" ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Amendment</dt>
          <dd className="font-mono">{c.code ?? "—"}</dd>
          <dt className="text-muted-foreground">Item</dt>
          <dd>{c.item ?? "—"}</dd>
          <dt className="text-muted-foreground">Old rate</dt>
          <dd className="tabular-nums">
            {c.currency} {rateText(c.previousRate)}{" "}
            <span className="text-muted-foreground">({rateText(c.previousRateGst)} incl. GST)</span>
          </dd>
          <dt className="text-muted-foreground">New rate</dt>
          <dd className="font-semibold tabular-nums">
            {c.currency} {rateText(c.revisedRate)}{" "}
            <span className="font-normal text-muted-foreground">({rateText(c.revisedRateGst)} incl. GST)</span>
          </dd>
          <dt className="text-muted-foreground">Quantity</dt>
          <dd className="tabular-nums">{fmtNumber(c.quantity)}</dd>
          <dt className="text-muted-foreground">Line value</dt>
          <dd className="tabular-nums">{signedMoney(c.currency, c.valueChange)}</dd>
          <dt className="text-muted-foreground">Budget</dt>
          <dd className={c.profitHit ? "font-semibold text-danger tabular-nums" : "tabular-nums"}>
            {rateBudgetLine(c)}
            {c.profitHit && c.budgetRate != null ? (
              <span className="block font-normal text-muted-foreground">
                Budget ₹ {rateText(c.budgetRate)} incl. GST · ₹ {rateText(c.overPerUnit ?? 0)} over per unit
              </span>
            ) : null}
          </dd>
        </dl>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Request</dt>
            <dd className="font-mono">{c.code ?? "—"}</dd>
            <dt className="text-muted-foreground">Scope</dt>
            <dd>{c.scope === "whole" ? "Whole PO" : "Part"}</dd>
            <dt className="text-muted-foreground">Value cancelled</dt>
            <dd className="font-semibold tabular-nums">
              {c.currency} {fmtFixed(c.cancelValue, 2)}
            </dd>
          </dl>
          <ul className="space-y-1 rounded-md border border-border p-2.5 text-xs">
            {c.lines.map((l, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <Truncated className="min-w-0 flex-1">{l.item ?? "Item"}</Truncated>
                <span className="shrink-0 tabular-nums">
                  {fmtNumber(l.cancelQty)} of {fmtNumber(l.openQty)} {l.uom ?? ""}
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    ordered {fmtNumber(l.orderedQty)} · received {fmtNumber(l.receivedQty)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
        <span className="font-semibold">Reason: </span>
        {c.reason ?? <span className="text-muted-foreground">None given</span>}
      </div>
      {href ? (
        <Link href={href} className="text-xs font-medium text-primary hover:underline">
          Open the {c.kind === "rate" ? "rate amendment" : "cancellation request"}
        </Link>
      ) : null}
    </>
  );
}

/** A rate: three decimals under ₹10 (a 0.44 label), two above. */
function rateText(v: number): string {
  return fmtFixed(v, Math.abs(v) < 10 ? 3 : 2);
}

/** A PO's card stats (0764): the impact leads, as Profit leads on a budget. */
function poStats(po: PoApprovalCard): CardStat[] {
  return [
    { label: "Total", value: po.total },
    { label: "GST", value: po.gst },
    { label: "Delivery", value: po.deliveryDate ? fmtDate(po.deliveryDate) : "—" },
    {
      label: "Above budget",
      value: po.overCount == null ? "—" : `${po.overCount} of ${po.lineCount}${po.unbudgetedCount ? ` · ${po.unbudgetedCount} no budget` : ""}`,
    },
    { label: "Profit impact", value: poImpactLine(po) ?? "—", lead: true },
  ];
}

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
