import { requirePermission } from "@/lib/auth/server";
import { getAcceptedOrdersForBom } from "@/lib/orders/material-bom-service";
import { PageHeader } from "@/components/ui/page-header";
import { MaterialBomClient } from "./material-bom-client";

export default async function MaterialBomPage() {
  await requirePermission("orders", "view");

  const rows = await getAcceptedOrdersForBom();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prepare Material BOM"
        description="Accepted orders — pick an order to prepare its material bill of materials."
      />
      <MaterialBomClient rows={rows} />
    </div>
  );
}
