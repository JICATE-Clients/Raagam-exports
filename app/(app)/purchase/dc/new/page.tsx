import { requirePermission } from "@/lib/auth/server";
import {
  getVendors,
  getLocations,
  getItems,
  getUoms,
} from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { DcNewForm } from "../_components/dc-new-form";

export default async function DcNewPage() {
  await requirePermission("materials_purchase", "create");

  const [vendors, locations, items, uoms] = await Promise.all([
    getVendors(),
    getLocations(),
    getItems(),
    getUoms(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Delivery Challan"
        description="Record material sent to a processor — track returns until closed."
      />
      <DcNewForm
        vendors={vendors}
        locations={locations}
        items={items}
        uoms={uoms}
      />
    </div>
  );
}
