import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPackRatios } from "@/lib/orders/pack-ratio-service";
import { listOrderOptions } from "@/lib/orders/order-options";
import { PackRatiosClient } from "./pack-ratios-client";

export default async function PackRatiosPage() {
  await requirePermission("orders", "view");
  const [rows, orders] = await Promise.all([
    listPackRatios(),
    listOrderOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pack Ratios"
        description="Carton structure and size assortment matrix per order."
      />
      <PackRatiosClient rows={rows} orders={orders} />
    </div>
  );
}
