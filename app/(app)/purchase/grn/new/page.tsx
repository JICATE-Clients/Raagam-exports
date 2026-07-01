import { requirePermission } from "@/lib/auth/server";
import {
  getOpenPoLines,
  getVendors,
  getLocations,
} from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { GrnNewForm } from "../_components/grn-new-form";

export default async function GrnNewPage() {
  await requirePermission("materials_purchase", "create");

  const [openPoLines, vendors, locations] = await Promise.all([
    getOpenPoLines(),
    getVendors(),
    getLocations(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New GRN"
        description="Select a vendor, then pick open PO lines to receive."
      />
      <GrnNewForm
        openPoLines={openPoLines}
        vendors={vendors}
        locations={locations}
      />
    </div>
  );
}
