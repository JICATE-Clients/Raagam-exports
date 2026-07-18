import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listDomesticProdPlans } from "@/lib/planning/fabric-order-service";
import { DomesticProductionClient } from "./domestic-production-client";

export default async function DomesticProductionPage() {
  await requirePermission("planning", "view");
  const rows = await listDomesticProdPlans();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Domestic Production Plan"
        description="Local production planning by style, pack and size with box distribution."
      />
      <DomesticProductionClient rows={rows} />
    </div>
  );
}
