import { requirePermission } from "@/lib/auth/server";
import { hasPermission } from "@/lib/auth/types";
import { getOpenPoLines, getGrnReceivingLocations, getGrnStoresAndBins } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { GrnNewForm } from "../_components/grn-new-form";

export default async function GrnNewPage() {
  const user = await requirePermission("materials_purchase", "create");

  // The vendor list is read off the open POs (0777), so no separate vendor fetch.
  const [openPoLines, receiving, place] = await Promise.all([
    getOpenPoLines(),
    getGrnReceivingLocations(),
    getGrnStoresAndBins(),
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
        // `stores:approve` is the Store Manager key — the one that may
        // authorise an over-receipt. createGrn and the 0620 trigger re-check.
        canAuthorize={hasPermission(user, "stores", "approve")}
        stores={place.stores}
        bins={place.bins}
        defaultStoreId={place.defaultStoreId}
      />
    </div>
  );
}
