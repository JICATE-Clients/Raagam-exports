import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listContractReviews } from "@/lib/orders/booking-service";
import { listOrderOptions } from "@/lib/orders/order-options";
import { ContractReviewClient } from "./contract-review-client";

export default async function ContractReviewPage() {
  await requirePermission("orders", "view");
  const [rows, orders] = await Promise.all([
    listContractReviews(),
    listOrderOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contract Review"
        description="Review order profitability and approve/reject based on IOC vs order value."
      />
      <ContractReviewClient rows={rows} orders={orders} />
    </div>
  );
}
