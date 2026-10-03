"use client";

/**
 * Orders ▸ Approval — step 6 of the client's order flow (0428).
 *
 * A QUEUE OVER THE BUDGET'S OWN STATUS, not a second document. A separate STEP
 * is not a separate record: two records would let the approved figures drift
 * from the budget they approved, which is what
 * `doc/orders-six-step.md` argues at length and what `/orders/approve-amendments`
 * already does one door along.
 *
 * ## THE APPROVER READS, THEY DO NOT EDIT
 *
 * There is no `MasterFullScreen` here and no field the approver can type into
 * except the decision remark. Everything about the budget is shown read-only in
 * a detail panel, because an approver who can change the numbers is not
 * approving them — they are co-authoring, and nobody afterwards can say which
 * version was agreed. Editing is `/orders/budgets`, and the server refuses it
 * while the budget is submitted.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Check, FileText, Layers, RotateCcw, Users, X, Undo2 } from "lucide-react";
import { RowIconAction } from "@/components/ui/row-actions";
import { findOrderReport, orderReportHref } from "@/lib/orders/order-reports";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdGroup, flagFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_WIDTH, Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { DetailSection } from "@/components/masters/detail-section";
import { StatusPill } from "@/components/ui/status-pill";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { Truncated } from "@/components/ui/truncated";
import { Tooltip } from "@/components/ui/tooltip";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { budgetTotals } from "@/lib/orders/budget/totals";
import type { OrderApprovalCard as OrderCardData } from "@/lib/approvals/order-approval-cards";
import { ApprovalOverview } from "./approval-overview";
import { MARGIN_TARGET_PCT } from "@/lib/orders/budget/breakdown";
import {
  BUDGET_STATUSES,
  budgetStatusText,
  budgetStatusTone,
  canTransition,
  type BudgetApprovalRow,
  type BudgetStatus,
  type OrderBudget,
} from "@/lib/orders/budget/types";
import { decideBudget, reopenBudget } from "@/lib/orders/budget/actions";
import { lineInputOf, orderInputsOfSnapshot } from "@/lib/orders/budget/figures";
import { loadBudgetApprovalSheet } from "@/lib/orders/budget/approval-sheet-actions";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { VarianceTable } from "@/components/orders/revision-variance-table";
import type { RevisionComparisonData } from "@/lib/orders/order-amendments/service";
import { isRefusal } from "@/lib/orders/budget/totals";
import type {
  ApprovalRun,
  CanActVerdict,
  TimelineRow,
} from "@/lib/approvals/types";

/**
 * THE SHEET'S CAPS (Phase 6, 2026-09-18). The sheet is `lg` — full width — so
 * without these every section is a pane-wide card around a few narrow values.
 * Each is the sum of its own row, stated once; a DetailSection adds its
 * `p-2.5` (2 x 10) and border (2 x 1). A DEFINITE LENGTH, NEVER `max-w-fit`:
 * `DetailSection` declares `@container/section`, so a content-sized cap
 * resolves to 0 and the card collapses (the Vendor master's bug).
 *
 * BUDGET — Date `range` 112 (dd/mm/yyyy), Status `code` 144 ("Submitted"),
 * Currency `hug` 88 (three letters; the label is the floor), Exchange rate
 * `hug` 88 ("84.0000"), Submitted / Decided `term` 176 (dd/mm/yyyy hh:mm):
 *     112 + 144 + 88 + 88 + 176 + 176 + 5 x 12 = 844, + 22 = 866
 *     ->  55rem (880), 14px of slack
 *
 * ORDERS — RE No `code` 144 ("HO/RE/26-27/0013"), customer `name` 288 (text,
 * truncated with its reveal), value `code` 144:
 *     144 + 288 + 144 + 2 x 16 = 608, + 22 = 630  ->  40rem (640)
 *
 * FIGURES and AS SUBMITTED — the General section's `FigureCell` rows. Their
 * longest line is the cost-by-source row, five `code` cells:
 *     5 x 144 + 4 x 12 = 768, + 22 = 790
 *
 * ONE CAP FOR EVERY SECTION (user 2026-09-20, screenshot 2970: "fix the ui of
 * the approval screen"). Each section used to be capped to its OWN widest row
 * — 880 / 640 / 800 / full — so the cards ended at four different right edges
 * and the Approval card ran the whole pane. They now share the widest row's
 * cap, the Budget row's 866 -> 55rem (880), and read as one column.
 *
 * FULL WIDTH SINCE THE DESKTOP PAGE (2026-09-30): the overview above them
 * spans the pane, so a 55rem section below ended short of its right edge —
 * the same four-edges problem one level up. They now all share its width.
 */
const SHEET_BOX_W = "w-full";
const ORDERS_BOX_W = SHEET_BOX_W;

/**
 * THE QUEUE'S FILTERS PANEL — the grouped drawer every Orders child draws
 * (user, 2026-09-23: "implement the Material BOM filter in every Orders
 * child"). It replaced a search box and a lone Status <Select>. Every facet is
 * read off the `BudgetApprovalRow` the table already shows.
 *
 * THE QUEUE STILL OPENS ON THE WORK — that is the Pending box on the search
 * row (see `quick` below), not this panel: the Status facet here starts at
 * All and, once set, takes over from the box.
 */

/**
 * WHICH OF THE THREE WORDS A BUDGET COUNTS AS, on an APPROVAL queue:
 *
 *  - Pending — `submitted`: with the approver, the one decision this screen
 *    is waiting on, and what it opens on.
 *  - Updated — `approved` / `rejected`: decided. The Order Revisions register
 *    reads both the same way.
 *  - Draft — not yet submitted, still with the merchandiser.
 *
 * STATED AS A MAP, NOT AS THREE TESTS IN THE FILTER. Those three tests were
 * what let a draft show under Updated as well as Draft on the Budgeting queue
 * next door (user, 2026-09-24) — this screen's three happened to be disjoint,
 * which is not the same as being unable to overlap. A `wordOf` returns one
 * word, and `BudgetStatus` keys the record, so a fifth state is a type error
 * here rather than a row that silently belongs to no word.
 */
const APPROVAL_WORD: Record<BudgetStatus, QuickWord> = {
  submitted: "pending",
  approved: "updated",
  rejected: "updated",
  draft: "draft",
};
const approvalWord = (r: BudgetApprovalRow): QuickWord => APPROVAL_WORD[r.status];

/**
 * THE APPROVER'S WORDS FOR A BUDGET'S STATE (client 2026-10-03, the register
 * spec: Pending · Approved · Rework Requested · Draft). This queue only —
 * `budgetStatusText` is shared with Budgeting, where "Awaiting approval" is
 * the merchandiser's view of the same state. `rejected` is what the engine's
 * Request Rework leaves behind (2026-09-29), so on the screen that pressed it
 * the word is the button's.
 */
const approvalStatusText = (s: BudgetStatus): string =>
  s === "submitted" ? "Pending" : s === "rejected" ? "Rework Requested" : budgetStatusText(s);

/** The order's Budget report — `ORDER_REPORTS`' entry, never a hand-typed path. */
const BUDGET_REPORT = findOrderReport("budget");

function approvalFacets(rows: BudgetApprovalRow[]): FacetGroup<BudgetApprovalRow>[] {
  return [
    {
      title: "Status & dates",
      icon: <CalendarRange />,
      facets: [
        {
          key: "status",
          label: "Status",
          all: "All",
          wide: true,
          counted: true,
          options: BUDGET_STATUSES.map((s) => ({ value: s, label: approvalStatusText(s) })),
          match: (r, v) => r.status === v,
        },
        { key: "budgetDate", label: "Budget Date", all: "Any date", date: (r) => r.budget_date },
        { key: "submitted", label: "Submitted", all: "Any date", date: (r) => r.submitted_at },
      ],
    },
    {
      title: "Budget",
      icon: <Layers />,
      facets: [
        { key: "decided", label: "Decided", all: "Any date", wide: true, date: (r) => r.decided_at },
        {
          key: "orders",
          label: "Orders",
          all: "Any",
          options: [
            { value: "one", label: "One order" },
            { value: "several", label: "Several orders" },
          ],
          match: (r, v) => (v === "several") === r.order_count > 1,
        },
        flagFacet("lines", "Lines", (r) => r.line_count > 0, "Has lines", "No lines"),
      ],
    },
    ...createdGroup(rows, <Users />),
  ];
}

/** The RE Nos a budget covers, for the sheet's title — the reference an
 *  approver knows an order by. */
function reNosOf(b: OrderBudget | null | undefined): string[] {
  return (b?.orders ?? [])
    .map((o) => o.garment_order?.sales_order?.order_number ?? o.garment_order?.code ?? "")
    .filter(Boolean);
}

export function BudgetApprovalScreen({
  rows,
  cards = {},
  budgets,
  canApprove,
  canEdit,
  initialOpenId = null,
}: {
  rows: BudgetApprovalRow[];
  /** Each budget's ORDER card (`loadOrderApprovalCards`) — the facts the list
   *  and the sheet lead with. A budget missing here still lists, by its code. */
  cards?: Record<string, OrderCardData>;
  budgets: OrderBudget[];
  /** `orders:approve` — declared since 0001 and used here first. An editor is
   *  not thereby an approver. */
  canApprove: boolean;
  canEdit: boolean;
  /** The budget a notice link asked for (`?open=`), opened on arrival. */
  initialOpenId?: string | null;
}) {
  const { success, error: toastError } = useToast();
  const router = useRouter();
  const [isPending, start] = useTransition();

  /* ONE WAY IN, AND IT IS THE FULL PAGE (user 2026-09-30, screenshots 3160 /
     3161: "for desktop … full page view", "still opening side rail"). The RE
     No, both row icons and a deep link (`?open=`) all open this sheet — the
     order card, the budget and the Approve · Request Rework bar together. The
     small side panel the icons used to open is gone. */
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [remark, setRemark] = useState("");

  /**
   * THE APPROVAL PANEL for whichever budget is open (0500–0505).
   *
   * Loaded ON OPEN rather than for every row on the page: the queue can hold
   * dozens of budgets and exactly one gets read. `null` while it loads and after
   * a budget with no run — see the fallback note on the Decide block below,
   * which is what those two states are for.
   */
  const [loaded, setLoaded] = useState<{
    /**
     * WHICH BUDGET THIS PANEL DESCRIBES — and carrying it is what makes a stale
     * paint unrepresentable rather than merely guarded against.
     *
     * Closing one sheet and opening another before the first request lands would
     * otherwise put the previous budget's approval trail under the current
     * budget's figures, and an audit trail attached to the wrong document is
     * worse than no trail at all. A `live` flag in the effect would also fix
     * that, but only for the race it was written for; keying the DATA to its
     * subject means the render simply cannot show a mismatch.
     *
     * It also removes the synchronous `setState` the React Compiler rejects
     * ("avoid calling setState directly within an effect") — clearing on open is
     * now a render-time comparison rather than a second state write.
     */
    forId: string;
    run: ApprovalRun | null;
    verdict: CanActVerdict | null;
    timeline: TimelineRow[];
    names: Record<string, string>;
    /** The revised budget's Original · Last · Latest (null = not a revision). */
    revision: RevisionComparisonData | null;
  } | null>(null);

  /* The panel AND the revision comparison, one action (2026-09-24): the
     comparison used to be computed in the page loader for every submitted
     budget on every render, including the re-render each decision triggers. */
  useEffect(() => {
    if (!openId) return;
    void loadBudgetApprovalSheet(openId).then(({ panel: p, revision }) =>
      setLoaded({ forId: openId, ...p, revision }),
    );
  }, [openId]);

  /** Null while it loads, and null for a budget with no run — the two states the
   *  legacy Decide block below is the fallback for. */
  const panel = loaded && loaded.forId === openId ? loaded : null;
  /** Default: what is waiting. The queue lists everything so an approver can
   *  answer "what did I approve last week?", but the work is what opens. */
  /* THE PENDING / UPDATED / DRAFT BOX, MATERIAL BOM'S OWN (user 2026-09-21 ·
     09-22), first on the search row — `APPROVAL_WORD` above says which word a
     budget counts as, and why that is a map rather than three tests here.
     ONE FILTER, TWO CONTROLS, and deliberately connected, unlike the BOM
     queues' box and Filters panel: an independent box left at Updated beside
     a Status facet at Draft would show nothing, silently. So a word in the box
     clears the drawer's Status, and while the drawer's Status is set the box
     stands down — `useQuickStatus`'s `standDown` / `onPick`, which is this
     screen's own rule generalised, derived rather than synced so the two
     cannot drift. The drawer (user 2026-09-23) still reaches each state on
     its own. */
  const groups = useMemo(() => approvalFacets(rows), [rows]);
  const facets = useFacetFilter(rows, groups);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  const [search, setSearch] = useState("");
  /* THE SET THE FIGURES ARE COUNTED OVER — the list with the search and the
     Filters panel applied and this box's own word left off, so a figure is
     exactly what clicking that word would show. */
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatch(r)) return false;
      if (!q) return true;
      const c = cards[r.id];
      return [r.code, r.description, ...(c?.reNos ?? []), c?.customer, c?.styles, c?.merchandiser]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, cards, facetMatch, search]);
  const quick = useQuickStatus(approvalWord, {
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
    countRows: base,
  });
  const quickMatches = quick.matches;

  // The remark is typed and unsaved until a decision is taken, so it is real
  // unsaved work — a silent auto-reload mid-sentence loses it.
  useUnsavedGuard(!!remark.trim() || isPending);

  const budget = useMemo(
    () => budgets.find((b) => b.id === openId) ?? null,
    [budgets, openId],
  );

  const totals = useMemo(() => {
    if (!budget) return null;
    // `figures.ts` BUILDS THE ENGINE'S INPUTS — the same mapping the budget
    // screen and `submitBudget` use. This screen hand-built its own once, from
    // source/qty/rate alone, and its totals drifted from the author's the day
    // lines grew a currency. One builder is what stops that recurring.
    //
    // THE SNAPSHOT orders, not a live re-read: the approver must see the figures
    // the author submitted (0428), and submit rewrites that snapshot from the
    // same live facts the screen showed.
    return budgetTotals(
      (budget.lines ?? []).map(lineInputOf),
      orderInputsOfSnapshot(budget.orders ?? []),
    );
  }, [budget]);

  function close() {
    setOpenId(null);
    setRemark("");
  }

  function decide(decision: "approved" | "rejected") {
    if (!budget) return;
    start(async () => {
      const res = await decideBudget(budget.id, decision, remark || null);
      if (res.ok) {
        success(decision === "approved" ? "Budget approved" : "Budget rejected");
        close();
        // `decideBudget` revalidates this page in its own response (`rev()`).
      } else {
        toastError(res.error);
      }
    });
  }

  function reopen(id: string) {
    start(async () => {
      const res = await reopenBudget(id);
      if (res.ok) {
        success("Sent back to draft");
        close();
        // `reopenBudget` revalidates this page in its own response (`rev()`).
      } else {
        toastError(res.error);
      }
    });
  }

  /** Open the full approval page for a row — the one door (see `openId`). */
  function openFull(r: BudgetApprovalRow) {
    setRemark("");
    setOpenId(r.id);
  }

  const filtered = useMemo(() => base.filter(quickMatches), [base, quickMatches]);

  /* THE ROWS ARE ORDERS (client 2026-09-29, "the approval screen … connected
     with budget, which is wrong"). An approver knows an order by its RE No,
     customer and style — never by "Budget 3", a Group or a line count — so the
     list leads with the order, from its card (`loadOrderApprovalCards`, the
     same one the phone inbox draws). The budget number rides under the RE No:
     it is still the record being decided, and the reference Budgeting uses.
     Group, Date, Orders and Lines are gone (1 budget = 1 order since 09-19). */
  const cardOf = (r: BudgetApprovalRow) => cards[r.id];
  const columns: Column<BudgetApprovalRow>[] = [
    {
      header: "RE No",
      className: HUG,
      cell: (r) => (
        <button
          type="button"
          className="text-left"
          onClick={() => openFull(r)}
        >
          <span className="block font-mono text-xs font-semibold text-primary hover:underline">
            {cardOf(r)?.reNos.join(", ") || `Budget ${r.code ?? r.id.slice(0, 8)}`}
          </span>
          {cardOf(r)?.reNos.length ? (
            <span className="block text-[11px] text-muted-foreground">Budget {r.code ?? ""}</span>
          ) : null}
        </button>
      ),
    },
    /* CUSTOMER OVER STYLE, one column — the RE No / Budget pattern beside it.
       As two columns the row ran past the 1,155px pane and pushed Status and
       the decision icons off-screen (2026-09-30). */
    {
      header: "Customer / Style",
      cell: (r) => (
        <span className="block max-w-[13rem]">
          <Truncated className="block text-sm">{cardOf(r)?.customer ?? "—"}</Truncated>
          {cardOf(r)?.styles ? (
            <Truncated className="block text-[11px] text-muted-foreground">{cardOf(r)!.styles!}</Truncated>
          ) : null}
        </span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      className: HUG,
      cell: (r) => {
        const q = cardOf(r)?.orderQty;
        // The order's own unit (PCS, SETS…), never a hard-coded "Pcs".
        const u = cardOf(r)?.orderUnit;
        return (
          <span className="whitespace-nowrap tabular-nums text-sm">
            {typeof q === "number" ? fmtNumber(q) : "—"}
            {typeof q === "number" && typeof u === "string" && u ? (
              <span className="text-xs text-muted-foreground"> {u}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      header: "Ship",
      className: HUG,
      cell: (r) => {
        const d = cardOf(r)?.earliestShipment;
        return <span className="tabular-nums text-sm">{d ? fmtDate(d) : "—"}</span>;
      },
    },
    {
      header: "Merchandiser",
      cell: (r) => <Truncated className="block max-w-[8rem] text-sm">{cardOf(r)?.merchandiser ?? "—"}</Truncated>,
    },
    {
      header: "Version",
      className: HUG,
      cell: (r) => {
        const rev = cardOf(r)?.revision;
        return rev ? (
          <span className="text-xs">
            <span className="font-mono">{rev.entryNo ?? "Revision"}</span>
            {rev.revNo ? <span className="text-muted-foreground"> · Rev #{rev.revNo}</span> : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">V0</span>
        );
      },
    },
    {
      header: "Submitted",
      className: HUG,
      cell: (r) => (
        <span className="block text-sm">
          {/* DATE AND TIME, NEVER "10 mins ago": an age needs `Date.now()` in
              the render, which the React Compiler refuses and a phone with a
              wrong clock would get wrong (same reason as `is_overdue`). */}
          <span className="whitespace-nowrap tabular-nums">{r.submitted_at ? fmtDateTime(r.submitted_at) : "—"}</span>
          {cardOf(r)?.submittedBy ? (
            <span className="block text-[11px] text-muted-foreground">by {cardOf(r)!.submittedBy}</span>
          ) : null}
        </span>
      ),
    },
    /* MARGIN AGAINST THE 15% LINE — the number, and below the line the words,
       so the amber is never the only thing saying it (`MARGIN_TARGET_PCT`). */
    {
      header: "Margin %",
      align: "right",
      className: HUG,
      cell: (r) => {
        const c = cardOf(r);
        const m = c?.breakdown.ok ? c.breakdown.current.profitPct : (c?.kpis?.profit_pct ?? null);
        if (m == null) return <span className="text-sm text-muted-foreground">—</span>;
        if (isRefusal(m)) {
          return (
            <Tooltip label={m.refused}>
              <span className="text-xs text-warning">Suppressed</span>
            </Tooltip>
          );
        }
        const low = m < MARGIN_TARGET_PCT;
        return (
          <span className={cn("block text-right tabular-nums text-sm font-semibold", low ? "text-warning" : "text-success")}>
            {m.toFixed(1)}%
            {low && <span className="block text-[10px] font-normal">below {MARGIN_TARGET_PCT}%</span>}
          </span>
        );
      },
    },
    {
      header: "Status",
      className: HUG,
      cell: (r) => (
        <StatusPill tone={budgetStatusTone(r.status)}>{approvalStatusText(r.status)}</StatusPill>
      ),
    },
    /* THE TWO DECISIONS, each in its own colour: Request Rework amber,
       Approve green. Not `RowActions` — that cluster is View / Edit / Delete,
       and these are decisions. Both are drawn on every row so the column never
       jitters; one that cannot apply is disabled and its tooltip says why. The
       Edit pencil is gone (user 2026-09-30: "from approval no need it"). */
    rowActionsColumn<BudgetApprovalRow>(
      (r) => {
        const decidable = canApprove && r.status === "submitted";
        const label = r.code ?? r.id.slice(0, 8);
        const soId = cardOf(r)?.salesOrderIds[0];
        return (
          <div className="flex items-center justify-end gap-1">
            {/* REPORT FIRST — the eye's slot ("Row actions" in AGENTS.md):
                the order's Budget report, whose strip reaches the rest. Greyed
                and saying why when the budget has no order to key it on. */}
            <RowIconAction
              label="Budget report"
              name={cardOf(r)?.reNos[0] ?? label}
              icon={FileText}
              className="text-primary"
              onClick={soId && BUDGET_REPORT ? () => router.push(orderReportHref(soId, BUDGET_REPORT)) : undefined}
              disabledReason={soId && BUDGET_REPORT ? null : "No order on this budget yet"}
            />
            {/* NO EDIT ICON (user 2026-09-30): this is the approver's queue, and
                the budget is edited on Budgeting — a pencil here led away from
                the decision the row exists for. */}
            {/* REQUEST REWORK (client 2026-09-29) — was "Cancel", and it never
                cancelled anything: it is the engine's `reject`, which sends a
                first-time budget back to the merchandiser and restores V0 on a
                revision. The internal kind keeps its old name. */}
            <Tooltip label={decidable ? "Request Rework" : "Request Rework — only a submitted budget"}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Request rework on ${label}`}
                className="text-warning hover:bg-warning/10 hover:text-warning disabled:text-muted-foreground"
                disabled={!decidable || isPending}
                onClick={() => openFull(r)}
              >
                <RotateCcw />
              </Button>
            </Tooltip>
            <Tooltip label={decidable ? "Approve" : "Approve — only a submitted budget"}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Approve ${label}`}
                className="text-success hover:bg-success/10 hover:text-success disabled:text-muted-foreground"
                disabled={!decidable || isPending}
                onClick={() => openFull(r)}
              >
                <Check />
              </Button>
            </Tooltip>
          </div>
        );
      },
      "w-32",
    ),
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Approval"
          description="Step 6 — approve or reject a submitted order budget. The last gate before purchase may act on it."
        />

        {!canApprove && (
          // SAID, NOT HIDDEN. A queue with no buttons and no explanation reads as
          // broken; the permission is real and the client decides who holds it.
          <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            You can see budgets here but not decide on them — that needs the
            {/* nav-path: exempt -- a PERMISSION (`orders:approve`, rendered
                through MODULE_LABELS), not a menu path. The sentence says so
                and points at the Roles screen, so nothing here promises a row
                to click. */}
            <span className="font-medium text-foreground"> Orders ▸ Approve </span>
            permission, which is granted on the Roles screen.
          </p>
        )}

        {/* THE GROUPED DRAWER (user, 2026-09-23) — the box first, then the
            search box, as on Material BOM; the Status select moved into the
            panel. */}
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search RE No, customer, style or merchandiser…"
          leading={quick.segment}
          activeCount={facets.activeCount}
          onReset={facets.activeCount ? facets.reset : undefined}
          panel={facets.panel}
          right={`${filtered.length} of ${rows.length}`}
        />

        {/* AS WIDE AS ITS COLUMNS, not the pane (erp-table-fit skill, client
            2026-09-28, screenshot 145600). */}
        <div className="w-fit max-w-full">
        <DataTable
          columns={hugCreated(withCreatedColumns(columns, filtered))}
          rows={filtered}
          getKey={(r) => r.id}
          empty={
            quick.value === "pending" && facets.activeCount === 0
              ? "Nothing is waiting for approval."
              : "No order matches these filters."
          }
        />
        </div>
      </div>


      <Sheet
        open={!!budget}
        onClose={close}
        /* THE STAFF PROFILE'S HEADER (canvas board B): the page's name and
           where it sits, then the decision where "Edit staff" sits on a
           profile. The RE No, customer and status are the identity card's. */
        title={
          <span className="flex flex-col">
            <span>Order Approval</span>
            <span className="text-xs font-normal text-muted-foreground">
              Orders / Approval /{" "}
              <span className="font-mono text-foreground">{reNosOf(budget).join(", ") || `Budget ${budget?.code ?? ""}`}</span>
            </span>
          </span>
        }
        /* Approve · Request Rework — renders nothing unless `approval_can_act`
           said yes, so there is no permission check here. The override
           warning is printed in the page's right column instead. */
        headerActions={
          panel?.run && panel.verdict ? (
            <ApprovalActionBar
              run={panel.run}
              verdict={panel.verdict}
              subjectPath="/orders/budget-approval"
              /* The sheet's run and verdict were read before the decision —
                 close it rather than show a stale bar. */
              onDone={() => setOpenId(null)}
              rework
              compact
              overrideNote={false}
            />
          ) : undefined
        }
        size="lg"
        /* THE WHOLE SCREEN (user 2026-09-30, screenshot 3166: "organise it
           desktop fit instead of this kind of scrolling"). The 1180px reading
           cap left a gutter each side and pushed the three columns long; a
           dashboard of cards is not prose, so it takes the pane. */
        fullBleed
      >
        {budget && totals && (
          <>
            {/* THE DESKTOP PAGE IN THE STAFF PROFILE'S LAYOUT (user 2026-09-30,
                canvas "Approval Desktop Layout" board B) — see
                `approval-overview.tsx`. It replaced the phone card at 36rem and
                the Budget / Figures / As submitted sections that repeated each
                other below it; what follows here fills its middle column. */}
            <ApprovalOverview
              card={cards[budget.id]}
              budget={budget}
              totals={totals}
              timeline={panel?.run ? panel.timeline : null}
              names={panel?.names ?? {}}
              override={!!panel?.verdict?.can_act && !!panel.verdict.is_override}
            >

            {/* ORDERS — listed only when there is something the overview cannot
                say: more than one order, or an order whose value nobody could
                resolve (the margin does not include it, and that is exactly the
                fact that should stop a signature). */}
            {((budget.orders ?? []).length > 1 || (budget.orders ?? []).some((o) => o.sales_value == null)) && (
            <DetailSection
                label={`Orders (${(budget.orders ?? []).length})`}
                cols={1}
                className={ORDERS_BOX_W}
              >
                <ul className="space-y-1 text-sm">
                  {(budget.orders ?? []).map((o) => (
                    <li key={o.id} className="flex items-baseline gap-4">
                      <span className={cn(FIELD_WIDTH.code, "min-w-0 shrink-0")}>
                        <Truncated>
                          {o.garment_order?.sales_order?.order_number ??
                            o.garment_order?.code ??
                            "(order)"}
                        </Truncated>
                      </span>
                      <span className={cn(FIELD_WIDTH.name, "min-w-0 shrink-0 text-xs text-muted-foreground")}>
                        {o.garment_order?.customer?.name && (
                          <Truncated>{o.garment_order.customer.name}</Truncated>
                        )}
                      </span>
                      {/* THE REFUSAL IS SHOWN TO THE APPROVER. It is exactly the
                          fact that should stop a signature: an order whose value
                          nobody could resolve is one the margin below does not
                          include. */}
                      {o.sales_value == null ? (
                        <span className={cn(FIELD_WIDTH.code, "shrink-0 text-right text-xs text-danger")}>
                          {o.sales_refusal ?? "no value"}
                        </span>
                      ) : (
                        <span className={cn(FIELD_WIDTH.code, "shrink-0 text-right tabular-nums text-sm")}>
                          {fmtNumber(o.sales_value)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            {/* THE REVISION, IN FULL, ABOVE THE BUTTONS (client 2026-09-24) —
                Original (V0) · Last · Latest by cost head, with the margin move
                as the headline. The same table the Revision's own Overview
                prints, so the MD signs against exactly what the merchandiser
                saw. Absent on a first-time budget: nothing to compare with. */}
            {budget && panel?.revision && (() => {
              const rc = panel.revision;
              const was = rc.baselineKpis?.profit_pct;
              const now = rc.currentKpis?.profit_pct;
              const known = was !== undefined && now !== undefined && !isRefusal(was) && !isRefusal(now);
              const d = known ? Math.round((now - was) * 100) / 100 : null;
              return (
                <>
                <DetailSection
                  label={`Revision ${rc.entryNo ?? ""} — budget comparison`}
                  cols={1}
                  className={SHEET_BOX_W}
                >
                  {/* WHO, WHEN, WHAT KIND — the revision's own facts, so the MD
                      knows what they are signing before reading a figure. */}
                  <dl className="mb-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                    <div><dt className="text-muted-foreground">Raised by</dt><dd>{rc.raisedBy ?? "—"}</dd></div>
                    <div><dt className="text-muted-foreground">Raised on</dt><dd>{rc.raisedAt ? fmtDateTime(rc.raisedAt) : "—"}</dd></div>
                    <div><dt className="text-muted-foreground">Category</dt><dd>{rc.categories || "—"}</dd></div>
                  </dl>
                  <p className="mb-2 text-sm">
                    Profit margin{" "}
                    {known ? (
                      <>
                        <span className="tabular-nums">{fmtNumber(was)}%</span> →{" "}
                        <span className="tabular-nums font-semibold">{fmtNumber(now)}%</span>{" "}
                        <span className={cn("tabular-nums font-medium", d! < 0 ? "text-danger" : d! > 0 ? "text-success" : "text-muted-foreground")}>
                          ({d! > 0 ? "+" : ""}{fmtNumber(d!)} pts)
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">— could not be compared</span>
                    )}
                  </p>
                  {rc.currentRefusal && (
                    <p className="mb-2 text-xs text-warning">Latest Budget figures could not be read: {rc.currentRefusal}</p>
                  )}
                  <VarianceTable detail={rc} />
                </DetailSection>

                {/* WHAT CHANGED IN THE ORDER — raise-time snapshot vs now, field
                    by field (client 2026-09-24). No per-field cost column: an
                    order field moves cost only through the BOMs and budget,
                    which the table above already breaks down by head. */}
                <DetailSection label="What changed in order details" cols={1} className={SHEET_BOX_W}>
                  {rc.changesRefusal ? (
                    <p className="text-xs text-warning">The order could not be compared: {rc.changesRefusal}</p>
                  ) : rc.changes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No order details changed — this revision moves the BOMs or the budget only.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[36rem] text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="py-2 pr-3 font-semibold">Section / Field</th>
                            <th className="py-2 px-3 font-semibold">Old value</th>
                            <th className="py-2 pl-3 font-semibold">New value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rc.changes.map((c, i) => (
                            <tr key={i} className="border-b border-border/60 align-top">
                              <td className="py-1.5 pr-3">
                                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                                  {c.section}{c.row ? ` · ${c.row}` : ""}
                                </span>
                                {c.field}
                              </td>
                              <td className="py-1.5 px-3 tabular-nums text-muted-foreground">{c.before}</td>
                              <td className="py-1.5 pl-3 tabular-nums font-medium">{c.after}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </DetailSection>

                {rc.reason && (
                  <DetailSection label="Merchandiser's reason for revision" cols={1} className={SHEET_BOX_W}>
                    <p className="text-sm">{rc.reason}</p>
                  </DetailSection>
                )}
                </>
              );
            })()}

            {budget.decision_remark && (
              <DetailSection label="Decision" cols={1} className={SHEET_BOX_W}>
                <p className="text-sm">{budget.decision_remark}</p>
              </DetailSection>
            )}

            {/* THE LEGACY DECIDE BLOCK, AND WHY IT SURVIVES.
                It is hidden the moment a run exists — two writers to one
                `status` column is exactly the divergence 0505's trigger raises
                to prevent, and offering both would let an approver decide here
                while the run stays open and in somebody's queue for ever.

                It stays for budgets SUBMITTED BEFORE the engine was installed.
                Those have no run, will never get one (a run starts at submit),
                and would otherwise be undecidable — a queue of documents with no
                button, which is a worse failure than an extra code path. Delete
                this block once no `submitted` budget predates 0503. */}
            {!panel?.run && canApprove && canTransition(budget.status, "approved") && (
              <DetailSection label="Decide" cols={1} className={SHEET_BOX_W}>
                <Field label="Remark" htmlFor="ba-remark">
                  <Textarea
                    id="ba-remark"
                    rows={3}
                    value={remark}
                    placeholder="Required when rejecting."
                    onChange={(e) => setRemark(e.target.value)}
                  />
                </Field>
                {/* APPROVE IS NOT THE LAST BUTTON BY ACCIDENT — this is a Sheet,
                    not a footer, so `submitTargetOf` never sees these. Reject is
                    the outline and Approve the solid one, in that order, so the
                    destructive-looking pair does not put a one-click Approve
                    under a cursor that was aiming at the textarea. */}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => decide("rejected")}
                    disabled={isPending}
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Reject
                  </Button>
                  <Button type="button" onClick={() => decide("approved")} disabled={isPending}>
                    <Check className="h-4 w-4" aria-hidden />
                    Approve
                  </Button>
                </div>
              </DetailSection>
            )}

            {canEdit && canTransition(budget.status, "draft") && (
              <DetailSection label="Rework" cols={1} className={SHEET_BOX_W}>
                <p className="mb-2 text-xs text-muted-foreground">
                  Sending this back to draft clears the rejection so the author can rework it. The
                  decision stays in the audit log.
                </p>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reopen(budget.id)}
                    disabled={isPending}
                  >
                    <Undo2 className="h-4 w-4" aria-hidden />
                    Send back to draft
                  </Button>
                </div>
              </DetailSection>
            )}
            </ApprovalOverview>
          </>
        )}
      </Sheet>
    </>
  );
}
