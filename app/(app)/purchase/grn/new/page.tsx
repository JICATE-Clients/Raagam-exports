import { requirePermission } from "@/lib/auth/server";
import { getOpenPoLines, getGrnReceivingLocations, getGrnStoresAndBins, getReplacementsDue } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { GrnNewForm } from "../_components/grn-new-form";

export default async function GrnNewPage() {
  await requirePermission("materials_purchase", "create");

  // The vendor list is read off the open POs (0777), so no separate vendor fetch.
  const [openPoLines, receiving, place, replacements] = await Promise.all([
    getOpenPoLines(),
    getGrnReceivingLocations(),
    getGrnStoresAndBins(),
    getReplacementsDue(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New GRN"
        description="Pick the vendor and PO; its items load ready for today's quantities."
      />
      <GrnNewForm
        openPoLines={openPoLines}
        locations={receiving.options}
        defaultLocationId={receiving.defaultId}
        stores={place.stores}
        bins={place.bins}
        defaultStoreId={place.defaultStoreId}
        replacements={replacements}
      />
    </div>
  );
}
