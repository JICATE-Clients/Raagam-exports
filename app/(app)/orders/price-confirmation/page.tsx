import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPriceConfirmations } from "@/lib/orders/pricing-service";
import { listOrderOptions } from "@/lib/orders/order-options";
import { PriceConfirmationClient } from "./price-confirmation-client";

export default async function PriceConfirmationPage() {
  await requirePermission("orders", "view");
  const [rows, orders] = await Promise.all([
    listPriceConfirmations(),
    listOrderOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Price Confirmation"
        description="Confirm procurement pricing for yarn, fabric, accessories, processes and CMT operations."
      />
      <PriceConfirmationClient rows={rows} orders={orders} />
    </div>
  );
}
