"use client";

/**
 * Orders ▸ Approval — step 8 of the client's order flow (0428).
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

import { useMemo, useState, useTransition } from "react";
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

  const totals = useMemo(() => {
    if (!budget) return null;
    return budgetTotals(
      (budget.lines ?? []).map((l) => ({ source: l.source, qty: l.qty, rate: l.rate })),
      (budget.orders ?? []).map((o) => ({
        label: o.garment_order?.sales_order?.order_number ?? o.garment_order?.code ?? "This order",
        // THE SNAPSHOT, not a live re-read. The approver must see the figures the
        // author submitted — re-valuing the orders here would mean approving one
        // set of numbers and recording another (0428).
        sales_value: o.sales_value,
        refusal: o.sales_refusal,
      })),
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
          description="Step 8 — approve or reject a submitted order budget. The last gate before purchase may act on it."
        />

        {!canApprove && (
          // SAID, NOT HIDDEN. A queue with no buttons and no explanation reads as
          // broken; the permission is real and the client decides who holds it.
          <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            You can see budgets here but not decide on them — that needs the
            <span className="font-medium text-foreground"> Orders ▸ Approve </span>
            permission, which is granted on the Roles screen.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
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
                      <span className="tabular-nums">{fmtNumber(totals.costBySource[k])}</span>
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
            </DetailSection>

            {budget.decision_remark && (
              <DetailSection label="Decision" cols={12}>
                <p className="text-sm">{budget.decision_remark}</p>
              </DetailSection>
            )}

            {canApprove && canTransition(budget.status, "approved") && (
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
