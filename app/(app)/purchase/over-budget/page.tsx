import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listOverBudget, getPoOptions } from "@/lib/purchase/extras-service";
import { OverBudgetClient } from "./over-budget-client";

export default async function OverBudgetPage() {
  await requirePermission("materials_purchase", "view");
  const [rows, pos, canCreate, canEdit, canApprove] = await Promise.all([
    listOverBudget(),
    getPoOptions(),
    can("materials_purchase", "create"),
    can("materials_purchase", "edit"),
    can("materials_purchase", "approve"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Price-over-Budget Confirmation"
        description="Route a quoted rate that exceeds the budget rate for management approval."
      />
      <OverBudgetClient rows={rows} pos={pos} canCreate={canCreate} canEdit={canEdit} canApprove={canApprove} />
    </div>
  );
}
