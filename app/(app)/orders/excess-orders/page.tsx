import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listExcessOrders } from "@/lib/orders/pack-ratio-service";
import { ExcessOrdersClient } from "./excess-orders-client";

export default async function ExcessOrdersPage() {
  await requirePermission("orders", "view");
  const rows = await listExcessOrders();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Excess Orders"
        description="Supplementary quantities beyond planned order with size-wise breakdown."
      />
      <ExcessOrdersClient rows={rows} />
    </div>
  );
}
