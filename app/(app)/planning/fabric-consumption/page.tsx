import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listFabricConsumptions } from "@/lib/planning/excess-consumption-service";
import { FabricConsumptionClient } from "./fabric-consumption-client";

export default async function FabricConsumptionPage() {
  await requirePermission("planning", "view");
  const rows = await listFabricConsumptions();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fabric Consumption"
        description="Fabric requirement tracking by component, structure, color, print and size."
      />
      <FabricConsumptionClient rows={rows} />
    </div>
  );
}
