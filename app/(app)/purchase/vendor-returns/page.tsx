import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listVendorReturns, getStoreOptions, getVendors } from "@/lib/stores/extras-service";
import { VendorReturnsClient } from "./vendor-returns-client";

export default async function VendorReturnsPage() {
  await requirePermission("stores", "view");
  const [rows, stores, vendors, canCreate] = await Promise.all([
    listVendorReturns(),
    getStoreOptions(),
    getVendors(),
    can("stores", "create"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Return to Vendor"
        description="Return rejected/excess material to a vendor and record the replacement."
      />
      <VendorReturnsClient rows={rows} stores={stores} vendors={vendors} canCreate={canCreate} />
    </div>
  );
}
