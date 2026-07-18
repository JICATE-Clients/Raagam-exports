import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listProductionPlans } from "@/lib/planning/capacity-service";
import { ProductionPlanningClient } from "./production-planning-client";

export default async function ProductionPlanningPage() {
  await requirePermission("planning", "view");
  const rows = await listProductionPlans();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production Planning"
        description="Master production schedule linking orders to work orders with timeline."
      />
      <ProductionPlanningClient rows={rows} />
    </div>
  );
}
