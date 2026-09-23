import { requirePermission } from "@/lib/auth/server";
import { hasPermission } from "@/lib/auth/types";
import {
  getOpenPoLines,
  getVendors,
  getGrnReceivingLocations,
} from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { GrnNewForm } from "../_components/grn-new-form";

export default async function GrnNewPage() {
  const user = await requirePermission("materials_purchase", "create");

  const [openPoLines, vendors, receiving] = await Promise.all([
    getOpenPoLines(),
    getVendors(),
    getGrnReceivingLocations(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New GRN"
        description="Pick the vendor and PO; its items load ready for today's quantities."
      />
      <GrnNewForm
        openPoLines={openPoLines}
        vendors={vendors}
        locations={receiving.options}
        defaultLocationId={receiving.defaultId}
        // `stores:approve` is the Store Manager key — the one that may
        // authorise an over-receipt. createGrn and the 0620 trigger re-check.
        canAuthorize={hasPermission(user, "stores", "approve")}
      />
    </div>
  );
}
