import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPipelineOrders, listSeasonalOrders } from "@/lib/sales/pipeline-service";
import { PipelineOrdersClient } from "./pipeline-orders-client";

export default async function PipelineOrdersPage() {
  await requirePermission("sales", "view");
  const [pipelineOrders, seasonalOrders] = await Promise.all([
    listPipelineOrders(),
    listSeasonalOrders(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pipeline & Seasonal Orders"
        description="Forecast orders for production planning and seasonal order tracking."
      />
      <PipelineOrdersClient pipelineOrders={pipelineOrders} seasonalOrders={seasonalOrders} />
    </div>
  );
}
