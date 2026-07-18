import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listMaterialRates } from "@/lib/planning/config-service";
import { MaterialRatesClient } from "./material-rates-client";

export default async function MaterialRatesPage() {
  await requirePermission("planning", "view");
  const rows = await listMaterialRates();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material Rates"
        description="Manage rates by item class, process and UOM."
      />
      <MaterialRatesClient rows={rows} />
    </div>
  );
}
