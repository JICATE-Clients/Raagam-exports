import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listContractReviews } from "@/lib/orders/booking-service";
import { ContractReviewClient } from "./contract-review-client";

export default async function ContractReviewPage() {
  await requirePermission("orders", "view");
  const rows = await listContractReviews();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contract Review"
        description="Review order profitability and approve/reject based on IOC vs order value."
      />
      <ContractReviewClient rows={rows} />
    </div>
  );
}
