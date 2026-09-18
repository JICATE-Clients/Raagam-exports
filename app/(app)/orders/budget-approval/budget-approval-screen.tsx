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
import { Field, FieldGrid } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { DetailSection } from "@/components/masters/detail-section";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { budgetTotals, isRefusal, BUDGET_SOURCE_LABELS, type BudgetSource } from "@/lib/orders/budget/totals";
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
        title={
          <>
            {budget?.code ?? "Budget"}
            {budget?.description && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {budget.description}
              </span>
            )}
          </>
        }
        size="lg"
      >
        {budget && totals && (
          <>
            <DetailSection label="Budget" cols={12}>
              <FieldGrid>
                <Field label="Date" size="sm">
                  <Input readOnly value={fmtDate(budget.budget_date)} />
                </Field>
                <Field label="Status" size="sm">
                  <Input readOnly value={budgetStatusText(budget.status)} />
                </Field>
                <Field label="Currency" size="sm">
                  <Input readOnly value={budget.currency_code ?? "—"} />
                </Field>
                <Field label="Exchange rate" size="sm">
                  <Input readOnly value={String(budget.exchange_rate ?? 1)} />
                </Field>
                {budget.submitted_at && (
                  <Field label="Submitted" size="sm">
                    <Input readOnly value={fmtDateTime(budget.submitted_at)} />
                  </Field>
                )}
                {budget.decided_at && (
                  <Field label="Decided" size="sm">
                    <Input readOnly value={fmtDateTime(budget.decided_at)} />
                  </Field>
                )}
              </FieldGrid>
              {budget.remark && (
                <p className="mt-2 text-xs text-muted-foreground">{budget.remark}</p>
              )}
            </DetailSection>

            <DetailSection label={`Orders (${(budget.orders ?? []).length})`} cols={12}>
              <ul className="space-y-1 text-sm">
                {(budget.orders ?? []).map((o) => (
                  <li key={o.id} className="flex items-baseline justify-between gap-4">
                    <span>
                      <Truncated>
                        {o.garment_order?.sales_order?.order_number ??
                          o.garment_order?.code ??
                          "(order)"}
                      </Truncated>
                      {o.garment_order?.customer?.name && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {o.garment_order.customer.name}
                        </span>
                      )}
                    </span>
                    {/* THE REFUSAL IS SHOWN TO THE APPROVER. It is exactly the
                        fact that should stop a signature: an order whose value
                        nobody could resolve is one the margin below does not
                        include. */}
                    {o.sales_value == null ? (
                      <span className="text-xs text-danger">{o.sales_refusal ?? "no value"}</span>
                    ) : (
                      <span className="tabular-nums text-sm">{fmtNumber(o.sales_value)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </DetailSection>

            <DetailSection label="Figures" cols={12}>
              <dl className="space-y-2">
                <Row label="Sales value" value={totals.sales} />
                <Row label="Total cost" value={totals.cost} />
                <Row label="Other income" value={totals.income} />
                <Row label="Profit / loss" value={totals.profit} strong />
                <Row label="Margin %" value={totals.profitPct} suffix="%" />
              </dl>

              <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                {(Object.keys(BUDGET_SOURCE_LABELS) as BudgetSource[])
                  .filter((k) => totals.costBySource[k] !== 0)
                  .map((k) => (
                    <div key={k} className="flex justify-between gap-4">
                      <span>{BUDGET_SOURCE_LABELS[k]}</span>
                      {(() => {
                        const v = totals.costBySource[k];
                        // A SOURCE CAN REFUSE since 0575 — a percent line whose
                        // sales base is unknown. Its sentence, never a 0.
                        return isRefusal(v) ? (
                          <span className="text-danger">{v.refused}</span>
                        ) : (
                          <span className="tabular-nums">{fmtNumber(v)}</span>
                        );
                      })()}
                    </div>
                  ))}
              </div>

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
              <DetailSection label="As submitted" cols={12}>
                <dl className="space-y-2">
                  <TextRow label="RE No" value={submitted.re_nos.join(", ")} />
                  <TextRow
                    label="Entry date"
                    value={submitted.entry_date ? fmtDate(submitted.entry_date) : ""}
                  />
                  <TextRow
                    label="Delivery"
                    value={submitted.delivery_dates.map((d) => fmtDate(d)).join(", ")}
                  />
                  <Row label="Order qty" value={submitted.order_qty} />
                  <Row label="Total income" value={submitted.total_income} />
                  <Row label="Total expenses" value={submitted.total_expenses} />
                  <Row label="Profit / loss" value={submitted.profit} strong />
                  <Row label="Profit %" value={submitted.profit_pct} suffix="%" />
                  <Row label="Cost per piece" value={submitted.cost_per_piece} />
                </dl>
              </DetailSection>
            )}

            {budget.decision_remark && (
              <DetailSection label="Decision" cols={12}>
                <p className="text-sm">{budget.decision_remark}</p>
              </DetailSection>
            )}

            {/* THE APPROVAL CHAIN — who has signed, who is signing, who is left.
                Rendered whenever a run exists, whatever its state: a REJECTED
                budget's trail is the one the author most needs to read, because
                it carries the reason. */}
            {panel?.run && (
              <DetailSection label="Approval" cols={12}>
                <ApprovalTimeline
                  rows={panel.timeline}
                  resolveUserName={(id) => panel.names[id]}
                />
                {panel.verdict && (
                  <div className="mt-3">
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
              <DetailSection label="Decide" cols={12}>
                <Field label="Remark" size="full" htmlFor="ba-remark">
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
              <DetailSection label="Rework" cols={12}>
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

/** One figure, or the sentence saying why there isn't one. */
function Row({
  label,
  value,
  suffix = "",
  strong = false,
}: {
  label: string;
  value: number | { refused: string };
  suffix?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={
          isRefusal(value)
            ? "text-right text-xs text-danger"
            : `text-right tabular-nums ${strong ? "text-base font-semibold" : "text-sm"} ${
                (value as number) < 0 ? "text-danger" : "text-foreground"
              }`
        }
      >
        {isRefusal(value) ? value.refused : `${fmtNumber(value as number)}${suffix}`}
      </dd>
    </div>
  );
}

/** A text fact — blank when there is none, since a missing date is not a
 *  refused figure. */
function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}
