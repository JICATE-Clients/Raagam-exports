import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listSqDetails } from "@/lib/sales/sq-service";
import { SqDetailsClient } from "./sq-details-client";

export default async function SqDetailsPage() {
  await requirePermission("sales", "view");
  const sqDetails = await listSqDetails();

  return (
    <div className="space-y-4">
      <PageHeader
        title="SQ Details"
        description="Sales Quote allocation — packs, quantities and delivery windows."
      />
      <SqDetailsClient rows={sqDetails} />
    </div>
  );
}
