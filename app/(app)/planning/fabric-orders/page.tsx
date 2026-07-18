import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listFabricOrders } from "@/lib/planning/fabric-order-service";
import { FabricOrdersClient } from "./fabric-orders-client";

export default async function FabricOrdersPage() {
  await requirePermission("planning", "view");
  const rows = await listFabricOrders();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fabric Orders"
        description="Internal fabric procurement orders with style, combo and size breakdown."
      />
      <FabricOrdersClient rows={rows} />
    </div>
  );
}
