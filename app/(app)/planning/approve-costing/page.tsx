import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listCostingsForApproval } from "@/lib/planning/costing-approval-service";
import { ApproveCostingClient } from "./approve-costing-client";

export default async function ApproveCostingPage() {
  await requirePermission("planning", "view");
  const [rows, canApprove] = await Promise.all([
    listCostingsForApproval(),
    can("planning", "approve"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Approve Costing"
        description="Planner sign-off on finalised garment costings before they feed order budgeting."
      />
      <ApproveCostingClient rows={rows} canApprove={canApprove} />
    </div>
  );
}
