import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getBudget,
  getBudgetOrders,
  getBudgetLines,
} from "@/lib/planning/budget-service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { BudgetDetail } from "./budget-detail";
import type { BudgetStatus } from "@/lib/planning/types";
import type { StatusTone } from "@/components/ui/status-pill";

function budgetStatusTone(status: BudgetStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ budgetId: string }>;
}) {
  await requirePermission("planning", "view");
  const { budgetId } = await params;

  const [budget, orders, lines, canApprove, canEdit, canDelete] =
    await Promise.all([
      getBudget(budgetId),
      getBudgetOrders(budgetId),
      getBudgetLines(budgetId),
      can("planning", "approve"),
      can("planning", "edit"),
      can("planning", "delete"),
    ]);

  if (!budget) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={budget.code ?? budget.name}
        description={
          budget.code && budget.code !== budget.name ? budget.name : undefined
        }
        actions={
          <StatusPill tone={budgetStatusTone(budget.status)}>
            {BUDGET_STATUS_LABELS[budget.status]}
          </StatusPill>
        }
      />

      {/* Summary strip */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Type</dt>
              <dd className="font-medium">
                {budget.is_grouped ? "Grouped" : "Single order"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total amount</dt>
              <dd className="tabular-nums font-medium">
                {fmtMoney(budget.total_amount, budget.currency_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd className="font-medium">{budget.currency_code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="tabular-nums font-medium">
                {fmtDate(budget.created_at)}
              </dd>
            </div>
            {budget.approved_at && (
              <div>
                <dt className="text-xs text-muted-foreground">Approved</dt>
                <dd className="tabular-nums font-medium">
                  {fmtDate(budget.approved_at)}
                </dd>
              </div>
            )}
            {budget.notes && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="text-sm">{budget.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Client component handles orders, lines, and workflow actions */}
      <BudgetDetail
        budget={budget}
        orders={orders}
        lines={lines}
        canApprove={canApprove}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
