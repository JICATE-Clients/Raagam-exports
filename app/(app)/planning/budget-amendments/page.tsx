import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listBudgetAmendments,
  getApprovedBudgets,
} from "@/lib/planning/amendment-service";
import { BudgetAmendmentsClient } from "./budget-amendments-client";

export default async function BudgetAmendmentsPage() {
  await requirePermission("planning", "view");

  const [amendments, budgets, canCreate, canEdit, canApprove, canExport] = await Promise.all([
    listBudgetAmendments(),
    getApprovedBudgets(),
    can("planning", "create"),
    can("planning", "edit"),
    can("planning", "approve"),
    can("planning", "export"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Budget Amendments"
        description="Formally revise an approved budget's total with an approval trail."
      />
      <BudgetAmendmentsClient
        amendments={amendments}
        budgets={budgets}
        canCreate={canCreate}
        canEdit={canEdit}
        canApprove={canApprove}
        canExport={canExport}
      />
    </div>
  );
}
