import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listSqDetails } from "@/lib/sales/sq-service";
import { listGarmentRejectionRules } from "@/lib/masters/garment-rejection-rule-service";
import { SqDetailsClient } from "./sq-details-client";

export default async function SqDetailsPage() {
  await requirePermission("sales", "view");
  // Both in one round trip — the rule list is small and the picker needs its
  // TIERS, not just its name, so the screen can show the answer before saving.
  const [sqDetails, rejectionRules] = await Promise.all([
    listSqDetails(),
    listGarmentRejectionRules(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="SQ Details"
        description="Sales Quote allocation — packs, quantities and delivery windows."
      />
      <SqDetailsClient rows={sqDetails} rules={rejectionRules} />
    </div>
  );
}
