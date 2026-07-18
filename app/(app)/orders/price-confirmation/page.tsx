import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPriceConfirmations } from "@/lib/orders/pricing-service";
import { PriceConfirmationClient } from "./price-confirmation-client";

export default async function PriceConfirmationPage() {
  await requirePermission("orders", "view");
  const rows = await listPriceConfirmations();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Price Confirmation"
        description="Confirm procurement pricing for yarn, fabric, accessories, processes and CMT operations."
      />
      <PriceConfirmationClient rows={rows} />
    </div>
  );
}
