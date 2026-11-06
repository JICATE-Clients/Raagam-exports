"use client";

import { PersonAvatar } from "@/components/ui/person-avatar";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtDateTime, fmtFixed, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { FIELD_ROW } from "@/components/ui/field";
import { FigureCell, HighlightTile, signTone } from "../orders/budgets/budget-general";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { WORKFLOWS, WORKFLOW_LIST, workflowLabel } from "@/lib/approvals/workflows";
import type { CanActVerdict, MyDecisionItem, MyRequestItem, QueueItem, StrandedRun } from "@/lib/approvals/types";
import { ApprovalsPhoneView, FAMILY, faceOf, familyOf } from "@/components/approvals/approvals-phone-view";
import { PoMoneyChart } from "@/components/approvals/po-money-chart";
import { CompactTrail, FactGrid, LineCards, PdSheetBody, SheetIdentity, SheetSection } from "@/components/approvals/sheet-parts";
import { loadPoApprovalSheet } from "@/lib/purchase/po-approval-sheet-actions";
import { loadRunTimeline } from "@/lib/approvals/status-actions";
import { loadPdReview } from "@/lib/sales/pd-requests/actions";
import type { RunTimelineResult } from "@/lib/approvals/types";
import { RevisionComparePanel } from "@/components/approvals/revision-compare-panel";
import { revisionCompareAction } from "@/lib/approvals/revision-compare-actions";
import type { RevisionCompare } from "@/lib/approvals/revision-compare";
import { BudgetBreakdownChart } from "@/components/orders/budget-breakdown-chart";
import type { OrderApprovalCard as OrderCardData } from "@/lib/approvals/order-approval-cards";
import type { PoApprovalCard, PoChangeCard } from "@/lib/approvals/po-approval-cards";
import { approvePo, declinePo } from "@/lib/purchase/po-actions";
import { forwardTimeoff, hrNextStage } from "@/lib/hr/timeoff-actions";
import { ClipboardCheck } from "lucide-react";
import { RowIconAction } from "@/components/ui/row-actions";
import { BackLink } from "@/components/ui/back-link";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { ToggleGroup } from "@/components/ui/segmented";

/** Each workflow's own approval page name — the title its sheet opens under. */
const PAGE_NAME: Record<string, string> = {
  purchase_order: "PO Approval",
  order_budget: "Order Approval",
  iwo_budget: "IWO Budget Approval",
  order_amendment: "Revision Approval",
  sample_pd_request: "PD Acknowledge",
  timeoff_request: "Leave Approval",
  po_rate_amendment: "Rate Amendment Approval",
  po_cancellation: "PO Cancellation Approval",
  hr_fine: "Staff Fine Approval",
};

/** A request I raised (0807), with the name of whoever made its latest decision. */
export type RequestRow = MyRequestItem & { actor_name: string | null };

/** A phone, by the same 768px line Tailwind's `md:` draws — a media query is an
 *  external store (see `useFinePointer` in data-picker.tsx for the reasoning). */
/**
 * ONE "HR & PAYROLL" TAB FOR EVERY HR APPROVAL (user 2026-11-06) — leave,
 * permission, on duty, comp-off, encashment, fines, PF, hiring — rather than a
 * tab per workflow. The same requests also stay on HR ▸ Time Off ▸ Time Off
 * Approvals; deciding from either is the same decision.
 */
const HR_TAB = "family:hr";
const tabOf = (workflowKey: string) => (familyOf(workflowKey) === "hr" ? HR_TAB : workflowKey);

/** The workflows whose stages escalate rather than all sign (0820). */
const HR_FORWARD = new Set<string>(["timeoff_request", "timeoff_encashment"]);

function useIsPhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(max-width: 767px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

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
  budgets,
  pos = {},
  poChanges = {},
  verdicts,
  viewToggle,
  allOpen = false,
  requests = [],
  decisions = [],
  codes = {},
  faces = {},
}: {
  /** My requests (0807) — the phone's status tab. Empty on All open. */
  requests?: RequestRow[];
  /** What I decided (0807) — the phone's Decided tab. */
  decisions?: MyDecisionItem[];
  /** Document numbers for queue rows with no richer card, keyed by subject id. */
  codes?: Record<string, string>;
  /** HR requests: subject id → "staff:<id>" / "worker:<id>" — the person's photo in place of the type icon. */
  faces?: Record<string, string>;
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
  /** Accepted and unused since 2026-11-04 — it only gated the removed Approval Flows button. */
  canViewAll?: boolean;
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
  const isPhone = useIsPhone();
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
  /** The open sheet's approval trail, and a PD request's own content — see `openDecision`. */
  const [trail, setTrail] = useState<{ runId: string; result: RunTimelineResult | null } | null>(null);
  const [pdReview, setPdReview] = useState<{ runId: string; data: Awaited<ReturnType<typeof loadPdReview>> | null } | null>(null);
  /** HR requests (0820/0821): the stage "Send to …" would land on, read on open. */
  const [hrNext, setHrNext] = useState<{ runId: string; to: string | null } | null>(null);
  const [poSheet, setPoSheet] = useState<{ runId: string; data: Awaited<ReturnType<typeof loadPoApprovalSheet>> | null } | null>(null);
  /* THE COST BREAKDOWN ARRIVES WITH THE CARD (Phase 2, 2026-09-30) —
     `loadOrderApprovalCards` computes it with the queue, so the tap that
     opens the sheet no longer waits on a second action for it. */
  const openDecision = (r: QueueRow) => {
    setDecideOn(r.run_id);
    /* EVERYTHING IS READ HERE, NOTHING SENDS THE APPROVER AWAY (user 2026-11-04: "we need
       to open here, no need to redirect the actual module screen"). On open — an event,
       not an effect — the run's approval trail for every workflow, and a PD request's own
       content (the Sample screen's `loadPdReview`). Keyed by run, so a late answer never
       paints the previous request under this one. */
    if (trail?.runId !== r.run_id) {
      setTrail({ runId: r.run_id, result: null });
      loadRunTimeline(r.run_id)
        .catch((): RunTimelineResult => ({ ok: false, error: "Could not load the approval trail" }))
        .then((result) => setTrail((t) => (t?.runId === r.run_id ? { runId: r.run_id, result } : t)));
    }
    if (r.workflow_key === WORKFLOWS.sample_pd_request.key && pdReview?.runId !== r.run_id) {
      setPdReview({ runId: r.run_id, data: null });
      loadPdReview(r.subject_id)
        .catch(() => null)
        .then((data) => setPdReview((p) => (p?.runId === r.run_id ? { runId: r.run_id, data } : p)));
    }
    if (HR_FORWARD.has(r.workflow_key) && hrNext?.runId !== r.run_id) {
      setHrNext({ runId: r.run_id, to: null });
      hrNextStage(r.run_id)
        .catch(() => null)
        .then((to) => setHrNext((h) => (h?.runId === r.run_id ? { runId: r.run_id, to } : h)));
    }
    /* A PO's own lines for the line cards — PO Approval's loader, read on open. */
    if (r.workflow_key === WORKFLOWS.purchase_order.key && poSheet?.runId !== r.run_id) {
      setPoSheet({ runId: r.run_id, data: null });
      loadPoApprovalSheet(r.subject_id)
        .catch(() => null)
        .then((data) => setPoSheet((p) => (p?.runId === r.run_id ? { runId: r.run_id, data } : p)));
    }
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
    for (const w of WORKFLOW_LIST) seen.set(tabOf(w.key), 0);
    for (const r of rows) seen.set(tabOf(r.workflow_key), (seen.get(tabOf(r.workflow_key)) ?? 0) + 1);
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
      if (workflow && tabOf(r.workflow_key) !== workflow) return false;
      if (!needle) return true;
      return [workflowLabel(r.workflow_key), r.step_label, r.created_by_name ?? "", codes[r.subject_id] ?? ""]
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [rows, query, workflow, codes]);

  /* NO ROW LINKS OUT (user 2026-11-04: "we need to open here, no need to redirect the
     actual module screen"). Every row and card opens the decision sheet in place, and
     the sheet reads the document there — the `hrefFor` that built module links is gone. */

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
    /* DOCUMENT AND STEP READ LIKE THE PHONE CARD (user 2026-11-04, screenshots 4040 /
       4041: "this two field look not good and not better for user"). The Document cell
       said only the TYPE — "Sample PD Request", "Leave / Permission" — never WHICH one;
       the Step cell said "1. Managing Director / Raagam Admin" with nothing naming the
       number or the person. Both now come from the phone card's own `faceOf` / `FAMILY`,
       so the two layouts describe a request in one set of words: the type's icon and
       label, the record's own title, its party or requester; then "Step 1 · <role>" and
       "Waiting on <people>". */
    {
      header: "Document",
      className: "max-w-0 w-full",
      cell: (r) => {
        const face = faceOf(r, pos[r.subject_id], poChanges[r.subject_id], budgets[r.subject_id], codes[r.subject_id]);
        const fam = FAMILY[familyOf(r.workflow_key)];
        const Icon = fam.icon;
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            {faces[r.subject_id] ? (
              <PersonAvatar name={codes[r.subject_id]} person={faces[r.subject_id]} />
            ) : (
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", fam.well)}>
                <Icon className="size-4" aria-hidden />
              </span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{workflowLabel(r.workflow_key)}</span>
              {/* DECIDED HERE, NOT ON THE DOCUMENT'S PAGE (user 2026-10-31; every row since
                  2026-11-04 — "no need to redirect"): the title opens the sheet in place. */}
              <button
                type="button"
                onClick={() => openDecision(r)}
                className="min-w-0 text-left text-sm font-semibold text-primary hover:underline"
              >
                <Truncated className="block">{face.title}</Truncated>
              </button>
              {face.sub || face.amount ? (
                <Truncated className="block text-xs text-muted-foreground">
                  {[face.sub, face.amount].filter(Boolean).join(" · ")}
                </Truncated>
              ) : null}
              {/* The card's one fact (within / over budget, margin, rate change) — only where
                  the document HAS figures; a plain request's fact is its step, which the Step
                  column already says. */}
              {face.amount ? (
                <Truncated
                  className={cn(
                    "block text-xs",
                    face.factTone === "danger" ? "font-medium text-danger" : face.factTone === "warning" ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {face.fact}
                </Truncated>
              ) : null}
            </span>
          </span>
        );
      },
    },
    {
      header: "Step",
      className: HUG,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="whitespace-nowrap text-sm">
            <span className="text-muted-foreground">Step {r.step_order} · </span>
            {r.step_label}
          </span>
          {allOpen ? (
            r.approver_names?.length ? (
              <span className="text-xs text-muted-foreground">Waiting on {r.approver_names.join(", ")}</span>
            ) : (
              <span className="text-xs font-medium text-danger">Nobody holds this step</span>
            )
          ) : (
            <span className="text-xs text-muted-foreground">Waiting on you</span>
          )}
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
    /* THE ROW'S ICON IS THE TRAILING ACTIONS COLUMN, like every other listing (user
       2026-11-04, screenshot 4039: "my approval screen look not good comparing the
       remaining screen"). It was a headed "Decide" column mid-table, which also pushed
       Created Date / Created User AFTER Status — every other list ends Created · Status
       · icons, and `withCreatedColumns` now slots them there by itself. */
    rowActionsColumn<QueueRow>((r) => (
      <RowIconAction
        label={verdicts[r.run_id] ? "Review & decide" : "Review"}
        name={pos[r.subject_id]?.code ? `PO ${pos[r.subject_id].code}` : undefined}
        icon={ClipboardCheck}
        onClick={() => openDecision(r)}
      />
    )),
  ];

  /**
   * THE DECISION — one element, mounted in the sheet's HEADER on a desktop (Orders ▸
   * Approval's place for it) and pinned in its FOOTER on a phone (the thumb's reach).
   * The same bar the desktop document page mounts — one decision path, one
   * `lock_version` rule, one set of words; `run` is built from the queue row, which IS
   * the fresh read that field requires.
   */
  const decisionBar =
    decideRow && decideVerdict ? (
      <ApprovalActionBar
        run={{ id: decideRow.run_id, lock_version: decideRow.lock_version, status: "in_progress" }}
        verdict={decideVerdict}
        subjectPath="/approvals"
        /* An order budget and a PO read Approve · Request Rework (client 2026-09-29). */
        rework={decideRow.workflow_key === WORKFLOWS.order_budget.key || decideRow.workflow_key === WORKFLOWS.purchase_order.key}
        /* A SAMPLE PD REQUEST IS ANSWERED IN THE SAMPLE DEPARTMENT'S WORDS (client spec
           2026-10-14) — Acknowledged · Not Acknowledged · File Not Received. */
        acknowledge={decideRow.workflow_key === WORKFLOWS.sample_pd_request.key}
        /* EVERY PO IS APPROVED IN ONE CLICK (user 2026-10-31) through `approvePo`; Reject
           (`declinePo`) closes it for good. Non-PO workflows keep the engine's path. */
        onApprove={decideRow.workflow_key === WORKFLOWS.purchase_order.key ? () => approvePo(decideRow.subject_id) : undefined}
        onRejectForGood={
          decideRow.workflow_key === WORKFLOWS.purchase_order.key ? (reason) => declinePo(decideRow.subject_id, reason) : undefined
        }
        /* AN HR REQUEST CAN BE SENT UP INSTEAD OF DECIDED — HOD → HR Manager → ED (0820). */
        forward={
          hrNext?.runId === decideRow.run_id && hrNext.to
            ? {
                to: hrNext.to,
                send: (note) =>
                  forwardTimeoff(
                    decideRow.workflow_key === WORKFLOWS.timeoff_encashment.key ? "encashment" : "request",
                    decideRow.subject_id,
                    note,
                  ),
              }
            : undefined
        }
      />
    ) : null;

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
          /* THE MINE / ALL OPEN SWITCH SITS IN THIS ROW (user 2026-10-31,
             screenshot 3940: on its own row above the search it read as a stray
             control). Only a super admin is handed one. NO "APPROVAL FLOWS" BUTTON
             (user 2026-11-04: "remove that approval flow button in that screen") —
             the flows are set up from their own row, Approvals ▸ Approval Flows. */
          viewToggle ?? undefined
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

      {/* Desktop's search + Document facet. The phone filters by its type chips. */}
      <div className="hidden md:block">
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search document, step or requester…"
        /* THE DOCUMENT TYPES ARE WORDS IN THE ROW, with their counts — the Delivery
           Challans / PO Approval shape (2026-11-04). They were a <Select> behind the
           Filters button, the one list in the app that hid its type facet. Only types
           with something waiting are offered (plus the one in view), so the row stays
           short; a type nobody is waiting on is not a choice anyone needs. */
        leading={
          <ToggleGroup<string>
            label="Document type"
            value={workflow}
            onChange={setWorkflow}
            options={[
              { value: "", label: `All (${rows.length})` },
              ...workflowCounts
                .filter((w) => w.count > 0 || w.key === workflow)
                .map((w) => ({ value: w.key, label: `${w.key === HR_TAB ? "HR & Payroll" : workflowLabel(w.key)} (${w.count})` })),
            ]}
          />
        }
      />
      </div>

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
      {/* THE PHONE (user 2026-11-04, approved mockup "My Approvals Mobile"):
          To decide · My requests · Decided, type chips, one card shape for every
          workflow, two-tap Approve on the card, and the decision sheet below for
          the figures, the charts and Reject / Request Rework. Desktop keeps the
          table above, untouched. */}
      <div className="md:hidden">
        <ApprovalsPhoneView
          rows={rows}
          verdicts={verdicts}
          budgets={budgets}
          pos={pos}
          poChanges={poChanges}
          codes={codes}
          faces={faces}
          requests={allOpen ? [] : requests}
          decisions={allOpen ? [] : decisions}
          allOpen={allOpen}
          waited={waited}
          onOpenDecision={openDecision}
        />
      </div>
      {/* THE DECISION, WITH THE FIGURES STILL ON SCREEN. */}
      {decideRow && (
        <Sheet
          open
          onClose={() => setDecideOn(null)}
          /* FULL SCREEN ON EVERY DEVICE (it was a centred card on a desktop until this,
             and a bottom sheet on a phone before the approved phone page) (user 2026-11-04, screenshot 4049: "in desktop open
             full screen") — Orders ▸ Approval's page: the name and crumb in the header,
             three columns on a desktop (identity · the document · the trail), stacked on a
             phone in that same order. `fullBleed` lets the columns take the pane. */
          size="lg"
          fullBleed={!isPhone}
          alignToPane
          /* The decisions: in the HEADER on a desktop, as on Orders ▸ Approval; pinned at
             the FOOT on a phone (approved plan, the thumb's reach). One `decisionBar`. */
          headerActions={!isPhone && decisionBar ? decisionBar : undefined}
          footer={isPhone && decisionBar ? <div className="w-full">{decisionBar}</div> : undefined}
          /* THE PAGE'S NAME AND WHERE IT SITS — Orders ▸ Approval's header ("Order Approval
             / Orders / Approval / RE No"): the module's own approval page name, then the
             crumb ending in the document's number. */
          title={(() => {
            const page = PAGE_NAME[decideRow.workflow_key] ?? `${workflowLabel(decideRow.workflow_key)} Approval`;
            const no =
              decidePo?.code ??
              (decideRevision ? `${reOf(decideCard) ?? "Revision"}${decideRevision.revNo ? ` · Rev #${decideRevision.revNo}` : ""}` : null) ??
              reOf(decideCard) ??
              (decideChange ? changeTitle(decideChange) : null) ??
              codes[decideRow.subject_id] ??
              (pdReview?.runId === decideRow.run_id ? (pdReview.data?.sample?.smp_nos[0] ?? null) : null) ??
              workflowLabel(decideRow.workflow_key);
            return (
              <span className="flex min-w-0 flex-col">
                <span>{page}</span>
                <Truncated className="block text-xs font-normal text-muted-foreground">
                  My Approvals / {page} / <span className={HR_FORWARD.has(decideRow.workflow_key) ? "text-foreground" : "font-mono text-foreground"}>{no}</span>
                </Truncated>
              </span>
            );
          })()}
        >
          {(() => {
            /* THREE COLUMNS, ORDERS ▸ APPROVAL'S (user 2026-11-04, screenshot 4049): WHO AND
               WHAT on the left, THE DOCUMENT in the middle, THE TRAIL on the right — side by
               side on a desktop, stacked in that same order on a phone (approved "My Approvals
               Phone Full Page"). Every piece below is the one the sheet already drew; only
               where it sits changed. */
            const initialsOf = (s: string) =>
              s.split(/[\s/]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
            const statePill = (pending = "Pending") => (
              <StatusPill tone={decideRow.is_overdue ? "danger" : "warning"}>
                {decideRow.is_overdue ? `Overdue ${waited(decideRow.waiting_hours)}` : pending}
              </StatusPill>
            );
            const left: ReactNode[] = [];
            const mid: ReactNode[] = [];
            const right: ReactNode[] = [];

            if (decideCard) {
              /* ORDER APPROVAL — the order card's identity and facts. */
              left.push(
                <SheetIdentity
                  key="id"
                  tile={initialsOf(decideCard.customer ?? "RE")}
                  number={reOf(decideCard) ?? "Budget"}
                  sub={[decideCard.customer, decideCard.styles].filter(Boolean).join(" · ") || undefined}
                  pills={
                    <>
                      {statePill()}
                      <StatusPill tone="neutral">{decideRevision?.revNo ? `Rev #${decideRevision.revNo}` : "V0"}</StatusPill>
                    </>
                  }
                />,
                <FactGrid
                  key="facts"
                  facts={[
                    { label: "Budget", value: decideCard.budgetCode ?? "—", mono: true },
                    {
                      label: "Order qty",
                      value: typeof decideCard.orderQty === "number" ? `${fmtNumber(decideCard.orderQty)} ${decideCard.orderUnit ?? ""}`.trim() : "—",
                    },
                    { label: "Ship date", value: decideCard.earliestShipment ? fmtDate(decideCard.earliestShipment) : "—" },
                    { label: "Merchandiser", value: decideCard.merchandiser ?? "—" },
                    { label: "Submitted by", value: decideCard.submittedBy ?? decideRow.created_by_name ?? "—", full: true },
                    ...(decideRevision
                      ? [
                          { label: "Revision", value: decideRevision.entryNo ?? "—", mono: true },
                          { label: "Raised", value: `${decideRevision.raisedBy ?? decideRow.created_by_name ?? "—"} · ${fmtDateTime(decideRevision.raisedAt)}` },
                        ]
                      : []),
                  ]}
                />,
              );
              /* A REVISION IS DECIDED ON LAST vs LATEST (client 2026-09-24). */
              if (decideRevision) {
                mid.push(
                  <RevisionComparePanel key="cmp" state={compare?.entryId === decideRevision.entryId ? compare.result : null} />,
                  <div key="why" className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
                    <span className="font-semibold">Reason for revision: </span>
                    {decideRevision.reason ?? <span className="text-muted-foreground">None given</span>}
                  </div>,
                );
              }
              /* THE CHART BEFORE THE FIGURES (client 2026-09-29). */
              mid.push(
                <div key="chart" className="rounded-xl border border-border bg-surface p-3">
                  {decideCard.breakdown.ok ? (
                    <BudgetBreakdownChart current={decideCard.breakdown.current} original={decideCard.breakdown.original} />
                  ) : (
                    <p className="text-sm text-warning">Breakdown unavailable — {decideCard.breakdown.refused}</p>
                  )}
                </div>,
              );
            }

            if (decideChange) {
              left.push(
                <SheetIdentity key="id" tile="PO" number={changeTitle(decideChange)} sub={decideRow.created_by_name ? `from ${decideRow.created_by_name}` : undefined} pills={statePill()} />,
              );
              mid.push(<PoChangeDetail key="chg" card={decideChange} href={null} />);
            } else if (decidePo) {
              /* PO APPROVAL — profile card · tiles, ring, lines · summary. */
              const sheetPo = poSheet?.runId === decideRow.run_id ? poSheet.data?.po : null;
              const orders = poSheet?.runId === decideRow.run_id ? Object.values(poSheet.data?.sourceNos ?? {}) : [];
              left.push(
                <SheetIdentity
                  key="id"
                  tile={initialsOf(decidePo.vendor ?? "PO")}
                  number={decidePo.code ?? "PO"}
                  sub={decidePo.vendor ?? undefined}
                  pills={
                    <>
                      <StatusPill tone="neutral">{`${decidePo.lineCount} line${decidePo.lineCount === 1 ? "" : "s"}`}</StatusPill>
                      {statePill("Pending Approval")}
                    </>
                  }
                />,
                <FactGrid
                  key="facts"
                  facts={[
                    ...(orders.length ? [{ label: "Orders", value: [...new Set(orders)].join(", "), full: true }] : []),
                    { label: "PO date", value: sheetPo?.order_date ? fmtDate(sheetPo.order_date) : "—" },
                    { label: "Deliver by", value: decidePo.deliveryDate ? fmtDate(decidePo.deliveryDate) : "—" },
                    { label: "GST", value: decidePo.gstSplit.length ? decidePo.gstSplit.map((g) => `${g.label} ${g.amount}`).join(" · ") : decidePo.gst },
                    { label: "Payment", value: sheetPo?.payment_terms ?? "—" },
                    { label: "Raised by", value: decideRow.created_by_name ?? "—", full: true },
                  ]}
                />,
              );
              mid.push(<PoMoneyChart key="money" card={decidePo} />);
              if (sheetPo?.lines?.length) {
                mid.push(
                  <SheetSection key="lines" title="PO lines">
                    <LineCards
                      lines={(sheetPo.lines as unknown as { description: string; quantity: number; unit_price: number; amount: number; uom_id: string | null }[]).map((l) => {
                        const uom = poSheet?.data?.uoms.find((u) => u.id === l.uom_id)?.code ?? "";
                        const over = decidePo.overLines?.find((o) => l.description?.trim().startsWith(o.item));
                        return {
                          item: l.description?.trim() || "Item",
                          amount: fmtFixed(Number(l.amount ?? 0), 2),
                          meta: [
                            `${fmtNumber(Number(l.quantity ?? 0))} ${uom}`.trim(),
                            `Rate ${rateText(Number(l.unit_price ?? 0))}`,
                            ...(over ? [`Budget ${rateText(over.budget)} · over`] : []),
                          ],
                          over: !!over,
                        };
                      })}
                    />
                  </SheetSection>,
                );
              }
              /* EACH LINE OVER ITS BUDGET (user 2026-10-31) — five at most. */
              if (decidePo.overLines?.length) {
                mid.push(
                  <div key="over" className="rounded-md border border-danger/30 bg-danger/5 p-2.5 text-xs">
                    <p className="font-semibold text-danger">Approving this PO reduces order net profit by ₹ {fmtFixed(decidePo.profitHit ?? 0, 2)}</p>
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
                    {decidePo.overLines.length > 5 ? <p className="mt-1 text-muted-foreground">+{decidePo.overLines.length - 5} more on the PO</p> : null}
                  </div>,
                );
              }
              /* THE REASON ONLY WHEN THERE IS ONE (screenshot 4042). */
              if (decidePo.reason) {
                mid.push(
                  <div key="reason" className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
                    <span className="font-semibold">Reason: </span>
                    {decidePo.reason}
                  </div>,
                );
              }
              right.push(
                <SheetSection key="sum" title="PO summary">
                  <FactGrid
                    facts={[
                      { label: "Taxable", value: decidePo.taxable },
                      { label: "GST", value: decidePo.gst },
                      { label: "Total", value: <span className="font-semibold">{decidePo.total}</span>, full: true },
                    ]}
                  />
                </SheetSection>,
              );
            } else if (kpis) {
              /* THE SAME TILES THE DESKTOP BUDGET SCREEN DRAWS (`HighlightTile`). */
              mid.push(
                <dl key="kpi" className="flex flex-wrap items-stretch gap-2.5">
                  <HighlightTile w="code" tone="sales" label="Gross sales" value={kpis.total_income} />
                  <HighlightTile w="code" tone="plain" label="Total expenses" value={kpis.total_expenses} />
                  <HighlightTile w="code" tone={signTone(kpis.profit)} label="Profit / loss" value={kpis.profit} />
                  <HighlightTile w="hug" tone={signTone(kpis.profit)} label="Profit %" value={kpis.profit_pct} suffix="%" />
                </dl>,
                <dl key="fig" className={FIELD_ROW}>
                  <FigureCell w="code" label="Order qty" value={kpis.order_qty} />
                  <FigureCell w="code" label="Cost per piece" value={kpis.cost_per_piece} />
                  <FigureCell w="term" label="RE No" value={kpis.re_nos.join(", ")} />
                  <FigureCell w="term" label="Delivery" value={kpis.delivery_dates.map((d) => fmtDate(d)).join(", ")} />
                </dl>,
              );
            } else if (decideRow.workflow_key === WORKFLOWS.order_budget.key) {
              /* NO SUMMARY = a budget submitted before the column existed. */
              mid.push(
                <p key="nosum" className="text-xs text-muted-foreground">
                  No submitted summary was stored for this budget. Open it on a desktop to read the figures before deciding.
                </p>,
              );
            } else if (decideRow.workflow_key === WORKFLOWS.sample_pd_request.key) {
              /* PD ACKNOWLEDGE — read in place (no redirect): the SMP, then its sample. */
              const pd = pdReview?.runId === decideRow.run_id ? pdReview.data : null;
              if (pd?.sample) {
                left.push(
                  <SheetIdentity
                    key="id"
                    tile="PD"
                    number={pd.sample.swo_no ?? pd.sample.smp_nos[0] ?? "PD Request"}
                    sub={[pd.sample.styles[0]?.name ? `Style ${pd.sample.styles[0].name}` : null, decideRow.created_by_name ? `from ${decideRow.created_by_name}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                    pills={
                      <>
                        {decideRow.is_overdue ? statePill() : null}
                        {pd.sample.styles[0]?.sample_type ? <StatusPill tone="neutral">{pd.sample.styles[0].sample_type}</StatusPill> : null}
                      </>
                    }
                  />,
                );
                mid.push(<PdSheetBody key="pd" sample={pd.sample} />);
              } else {
                mid.push(
                  <p key="pdwait" className="text-xs text-muted-foreground">
                    {pd && !pd.sample ? "This SMP could not be read — it may have been deleted." : "Loading the request…"}
                  </p>,
                );
              }
            } else if (!decideCard) {
              /* EVERY OTHER WORKFLOW — who asked and when; the trail says where it stands. */
              left.push(
                <SheetIdentity
                  key="id"
                  tile={initialsOf(workflowLabel(decideRow.workflow_key))}
                  number={codes[decideRow.subject_id] ?? workflowLabel(decideRow.workflow_key)}
                  sub={decideRow.created_by_name ? `from ${decideRow.created_by_name}` : undefined}
                  pills={statePill()}
                />,
              );
              mid.push(
                <FactGrid
                  key="facts"
                  facts={[
                    { label: "Raised by", value: decideRow.created_by_name ?? "—" },
                    { label: "Raised on", value: fmtDateTime(decideRow.started_at) },
                  ]}
                />,
              );
            }

            /* THE APPROVAL TRAIL — the right column, for every workflow (loaded on open). */
            if (trail?.runId === decideRow.run_id) {
              right.push(
                <SheetSection key="trail" title="Approval">
                  {trail.result === null ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : trail.result.ok ? (
                    <CompactTrail
                      rows={trail.result.rows}
                      names={trail.result.names}
                      submittedBy={decideRow.created_by_name ?? null}
                      submittedAt={decideRow.started_at}
                    />
                  ) : (
                    <p className="text-xs text-danger">{trail.result.error}</p>
                  )}
                </SheetSection>,
              );
            }
            if (!decideVerdict) {
              /* READ-ONLY: in the list, but this login is not an approver on the step. */
              right.push(
                <p key="ro" className="rounded-md border border-border bg-surface-muted p-2.5 text-xs text-muted-foreground">
                  Waiting on {decideRow.step_label}. You can read it here, but you are not an approver on this step.
                </p>,
              );
            }

            return (
              <div className="space-y-4">
                {/* THE WAY BACK TO THE LIST (user 2026-11-04: "no back option"). */}
                <BackLink onBack={() => setDecideOn(null)} label="My Approvals" className="-ml-1 h-7" />
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(15rem,19rem)]">
                  <div className="min-w-0 space-y-3.5">{left}</div>
                  <div className="min-w-0 space-y-3.5">{mid}</div>
                  <div className="min-w-0 space-y-3.5">{right}</div>
                </div>
              </div>
            );
          })()}
        </Sheet>
      )}
    </div>
  );
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


/** The budget sentence for a rate amendment — the PO card's own words. */
function rateBudgetLine(c: Extract<PoChangeCard, { kind: "rate" }>): string {
  if (!c.hasBudget) return "No approved budget";
  if (c.budgetRate == null) return "—";
  if (!c.profitHit) return `Within budget (₹ ${rateText(c.budgetRate)} incl. GST)`;
  return `Approving this reduces order net profit by ₹ ${fmtFixed(c.profitHit, 2)}`;
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
      {c.reason ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
          <span className="font-semibold">Reason: </span>
          {c.reason}
        </div>
      ) : null}
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
