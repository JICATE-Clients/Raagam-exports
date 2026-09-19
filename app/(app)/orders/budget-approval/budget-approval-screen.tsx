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
import { Check, X, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_ROW, FIELD_WIDTH, Field, FieldRow } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { DetailSection } from "@/components/masters/detail-section";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { FigureCell, HighlightTile, signTone } from "../budgets/budget-general";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { budgetTotals, BUDGET_SOURCE_LABELS, type BudgetSource } from "@/lib/orders/budget/totals";
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
import { kpisFromJson } from "@/lib/orders/budget/amendment";
import { lineInputOf, orderInputsOfSnapshot } from "@/lib/orders/budget/figures";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
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
 */
const SHEET_BOX_W = "max-w-[55rem]";
const BUDGET_BOX_W = SHEET_BOX_W;
const ORDERS_BOX_W = SHEET_BOX_W;
const FIGURES_BOX_W = SHEET_BOX_W;

/** The RE Nos a budget covers, for the sheet's title — the reference an
 *  approver knows an order by. */
function reNosOf(b: OrderBudget | null | undefined): string[] {
  return (b?.orders ?? [])
    .map((o) => o.garment_order?.sales_order?.order_number ?? o.garment_order?.code ?? "")
    .filter(Boolean);
}

export function BudgetApprovalScreen({
  rows,
  budgets,
  canApprove,
  canEdit,
}: {
  rows: BudgetApprovalRow[];
  budgets: OrderBudget[];
  /** `orders:approve` — declared since 0001 and used here first. An editor is
   *  not thereby an approver. */
  canApprove: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [openId, setOpenId] = useState<string | null>(null);
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
  } | null>(null);

  useEffect(() => {
    if (!openId) return;
    void getApprovalPanel(WORKFLOWS.order_budget.subjectTable, openId).then((p) =>
      setLoaded({ forId: openId, ...p }),
    );
  }, [openId]);

  /** Null while it loads, and null for a budget with no run — the two states the
   *  legacy Decide block below is the fallback for. */
  const panel = loaded && loaded.forId === openId ? loaded : null;
  /** Default: what is waiting. The queue lists everything so an approver can
   *  answer "what did I approve last week?", but the work is what opens. */
  const [filter, setFilter] = useState<BudgetStatus | "all">("submitted");
  const [search, setSearch] = useState("");

  // The remark is typed and unsaved until a decision is taken, so it is real
  // unsaved work — a silent auto-reload mid-sentence loses it.
  useUnsavedGuard(!!remark.trim() || isPending);

  const budget = useMemo(
    () => budgets.find((b) => b.id === openId) ?? null,
    [budgets, openId],
  );
  /** The KPIs stored at submit, or null for a budget submitted before 0576
   *  (or a summary this version cannot read — `kpisFromJson` refuses rather
   *  than guessing at an unknown shape). */
  const submitted = budget ? kpisFromJson(budget.submitted_summary) : null;

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
        router.refresh();
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
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return [r.code, r.description]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const columns: Column<BudgetApprovalRow>[] = [
    {
      header: "Budget",
      cell: (r) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => {
            setOpenId(r.id);
            setRemark("");
          }}
        >
          {r.code ?? r.id.slice(0, 8)}
        </button>
      ),
    },
    { header: "Group", cell: (r) => <Truncated>{r.description ?? "—"}</Truncated> },
    {
      header: "Date",
      cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.budget_date)}</span>,
    },
    {
      header: "Orders",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.order_count}</span>,
    },
    {
      header: "Lines",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.line_count}</span>,
    },
    {
      header: "Submitted",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.submitted_at ? fmtDate(r.submitted_at) : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={budgetStatusTone(r.status)}>{budgetStatusText(r.status)}</StatusPill>
      ),
    },
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

        <div className="flex flex-wrap items-center gap-2">
          {/* caps-input: exempt -- a search QUERY is not a stored value. */}
          <Input uppercase={false}
            className="w-64"
            placeholder="Search budget or group…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            className="w-48"
            value={filter}
            onChange={(e) => setFilter(e.target.value as BudgetStatus | "all")}
          >
            <option value="submitted">Awaiting approval</option>
            {BUDGET_STATUSES.filter((s) => s !== "submitted").map((s) => (
              <option key={s} value={s}>
                {budgetStatusText(s)}
              </option>
            ))}
            <option value="all">All</option>
          </Select>
        </div>

        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(r) => r.id}
          empty={
            filter === "submitted"
              ? "Nothing is waiting for approval."
              : "No budgets in this state."
          }
        />
      </div>

      <Sheet
        open={!!budget}
        onClose={close}
        /* "BUDGET 1 · HO/RE/26-27/0012" and its state — it was the bare Entry
           No ("1"), which named nothing an approver recognises. */
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>Budget {budget?.code ?? ""}</span>
            {reNosOf(budget).length > 0 && (
              <span className="font-mono text-sm font-medium text-muted-foreground">
                · {reNosOf(budget).join(", ")}
              </span>
            )}
            {budget && (
              <StatusPill tone={budgetStatusTone(budget.status)}>{budgetStatusText(budget.status)}</StatusPill>
            )}
          </span>
        }
        size="lg"
      >
        {budget && totals && (
          <>
            <DetailSection label="Budget" cols={1} className={BUDGET_BOX_W}>
              <FieldRow>
                <Field label="Date" w="range">
                  <Input readOnly value={fmtDate(budget.budget_date)} />
                </Field>
                <Field label="Status" w="code">
                  <Input readOnly value={budgetStatusText(budget.status)} />
                </Field>
                <Field label="Currency" w="hug">
                  <Input readOnly value={budget.currency_code ?? "—"} />
                </Field>
                <Field label="Exchange rate" w="hug">
                  <Input readOnly value={String(budget.exchange_rate ?? 1)} />
                </Field>
                {budget.submitted_at && (
                  <Field label="Submitted" w="term">
                    <Input readOnly value={fmtDateTime(budget.submitted_at)} />
                  </Field>
                )}
                {budget.decided_at && (
                  <Field label="Decided" w="term">
                    <Input readOnly value={fmtDateTime(budget.decided_at)} />
                  </Field>
                )}
              </FieldRow>
              {budget.remark && (
                <p className="mt-2 text-xs text-muted-foreground">{budget.remark}</p>
              )}
            </DetailSection>

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

            <DetailSection label="Figures" cols={1} className={FIGURES_BOX_W}>
              {/* THE BOTTOM LINE AS THE BUDGET'S OWN TILES (budget-general.tsx):
                  the approver reads the figures in the colours the merchandiser
                  priced them in. No Other income — the tab left the budget
                  (client, 2026-09-19). */}
              <dl className="flex flex-wrap items-stretch gap-2.5">
                <HighlightTile w="code" tone="sales" label="Sales value" value={totals.sales} />
                <HighlightTile w="code" tone="plain" label="Total cost" value={totals.cost} />
                <HighlightTile w="code" tone={signTone(totals.profit)} label="Profit / loss" value={totals.profit} />
                <HighlightTile w="hug" tone={signTone(totals.profit)} label="Margin %" value={totals.profitPct} suffix="%" />
              </dl>

              {/* COST BY SOURCE, the same cells one tier down. A SOURCE CAN
                  REFUSE since 0575 — a percent line whose sales base is
                  unknown — and `FigureCell` prints its sentence, never a 0. */}
              <dl className={cn(FIELD_ROW, "mt-3 border-t border-border pt-2")}>
                {(Object.keys(BUDGET_SOURCE_LABELS) as BudgetSource[])
                  .filter((k) => totals.costBySource[k] !== 0)
                  .map((k) => (
                    <FigureCell
                      key={k}
                      w="code"
                      label={BUDGET_SOURCE_LABELS[k]}
                      value={totals.costBySource[k]}
                    />
                  ))}
              </dl>

              {totals.unpriced.length > 0 && (
                <p className="mt-3 text-xs text-danger">
                  {totals.unpriced.length} cost{" "}
                  {totals.unpriced.length === 1 ? "line is" : "lines are"} unpriced and excluded
                  from these figures.
                </p>
              )}
              {totals.pending.length > 0 && (
                // Priced, but a percentage of a sales value not known yet — the
                // totals it touches refuse above, and this says how many.
                <p className="mt-1 text-xs text-danger">
                  {totals.pending.length} {totals.pending.length === 1 ? "line is" : "lines are"}{" "}
                  waiting on a sales value.
                </p>
              )}
            </DetailSection>

            {/* AS SUBMITTED — the KPIs stored at submit (`submitted_summary`,
                0576): the figures this approval is being asked about. Shown
                BESIDE the live figures above rather than instead of them, so an
                order re-valued since submit is visible as a difference the
                approver can see, not a silent change under their signature. */}
            {submitted && (
              <DetailSection label="As submitted" cols={1} className={FIGURES_BOX_W}>
                {/* RE No(s) and Delivery date(s) are LISTS and may run long:
                    `term` holds one of each, and more wrap inside the cell. */}
                <dl className={FIELD_ROW}>
                  <FigureCell w="term" label="RE No" value={submitted.re_nos.join(", ")} />
                  <FigureCell
                    w="range"
                    label="Entry date"
                    value={submitted.entry_date ? fmtDate(submitted.entry_date) : ""}
                  />
                  <FigureCell
                    w="term"
                    label="Delivery"
                    value={submitted.delivery_dates.map((d) => fmtDate(d)).join(", ")}
                  />
                  <FigureCell w="code" label="Order qty" value={submitted.order_qty} />
                  {/* "Gross sales", not "Total income": with Other Incomes gone
                      (2026-09-19) the stored total income IS the sales value. */}
                  <FigureCell w="code" label="Gross sales" value={submitted.total_income} />
                  <FigureCell w="code" label="Total expenses" value={submitted.total_expenses} />
                  <FigureCell w="code" label="Profit / loss" value={submitted.profit} strong signed />
                  <FigureCell w="hug" label="Profit %" value={submitted.profit_pct} suffix="%" signed />
                  <FigureCell w="code" label="Cost per piece" value={submitted.cost_per_piece} />
                </dl>
              </DetailSection>
            )}

            {budget.decision_remark && (
              <DetailSection label="Decision" cols={1} className={SHEET_BOX_W}>
                <p className="text-sm">{budget.decision_remark}</p>
              </DetailSection>
            )}

            {/* THE APPROVAL CHAIN — who has signed, who is signing, who is left.
                Rendered whenever a run exists, whatever its state: a REJECTED
                budget's trail is the one the author most needs to read, because
                it carries the reason. */}
            {panel?.run && (
              /* `cols={1}`, NOT 12 (screenshot 2970). In the 12-column density
                 track every child that is not a `Field` took ONE column, so the
                 timeline and the action bar were squeezed into ~80px each and
                 "Step 1 · Managing Director" printed over itself. These sections
                 hold blocks, not fields; they stack. */
              <DetailSection label="Approval" cols={1} className={SHEET_BOX_W}>
                <ApprovalTimeline
                  rows={panel.timeline}
                  resolveUserName={(id) => panel.names[id]}
                />
                {panel.verdict && (
                  <div className="mt-3 border-t border-border pt-3">
                    {/* Renders NOTHING unless `approval_can_act` said yes, so
                        there is no permission check to write here and none to
                        get wrong. */}
                    <ApprovalActionBar
                      run={panel.run}
                      verdict={panel.verdict}
                      subjectPath="/orders/budget-approval"
                    />
                  </div>
                )}
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
          </>
        )}
      </Sheet>
    </>
  );
}
