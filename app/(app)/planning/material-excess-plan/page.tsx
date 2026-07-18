import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listMaterialExcessPlans } from "@/lib/planning/excess-consumption-service";
import { MaterialExcessPlanClient } from "./material-excess-plan-client";

export default async function MaterialExcessPlanPage() {
  await requirePermission("planning", "view");
  const rows = await listMaterialExcessPlans();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material Excess Plan"
        description="Waste allowances for ordering, issuing and receiving with size-wise overrides."
      />
      <MaterialExcessPlanClient rows={rows} />
    </div>
  );
}
