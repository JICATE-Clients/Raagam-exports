import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listCapacityPlans } from "@/lib/planning/capacity-service";
import { CapacityPlanningClient } from "./capacity-planning-client";

export default async function CapacityPlanningPage() {
  await requirePermission("planning", "view");
  const rows = await listCapacityPlans();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Capacity Planning"
        description="Schedule production across locations and teams with SAM, efficiency and timeline."
      />
      <CapacityPlanningClient rows={rows} />
    </div>
  );
}
