import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getBudget } from "@/lib/planning/budget-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { BudgetStatus } from "@/lib/planning/budget-types";
import { BUDGET_TYPE_LABELS } from "@/lib/planning/budget-types";
import { BudgetDetail } from "./budget-detail";

const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

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

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ budgetId: string }>;
}) {
  await requirePermission("planning", "view");
  const { budgetId } = await params;

  const [budget, canEdit, canDelete, canApprove] = await Promise.all([
    getBudget(budgetId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!budget) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={budget.code ?? "Budget"}
        description={`${BUDGET_TYPE_LABELS[budget.budget_type] ?? budget.budget_type} · Customer: ${budget.customer_name ?? "--"} · Group: ${budget.group_no ?? "--"} · ${fmtDate(budget.created_at)}`}
        actions={
          <StatusPill tone={budgetStatusTone(budget.status)}>
            {BUDGET_STATUS_LABELS[budget.status]}
          </StatusPill>
        }
      />

      <BudgetDetail
        budget={budget}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
