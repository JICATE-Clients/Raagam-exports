import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listShipmentPlans, getBuyers } from "@/lib/planning/shipment-plan-service";
import { ShipmentPlansClient } from "./shipment-plans-client";

export default async function ShipmentPlansPage() {
  await requirePermission("planning", "view");

  const [plans, buyers, canCreate] = await Promise.all([
    listShipmentPlans(),
    getBuyers(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipment Plans"
        description="Group orders into a planned shipping window before they hand off to Logistics."
      />
      <ShipmentPlansClient plans={plans} buyers={buyers} canCreate={canCreate} />
    </div>
  );
}
