import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listCspReceipts, getStoreOptions, getBuyers } from "@/lib/stores/extras-service";
import { CspReceiptsClient } from "./csp-receipts-client";

export default async function CspReceiptsPage() {
  await requirePermission("stores", "view");
  const [rows, stores, buyers, canCreate, canExport] = await Promise.all([
    listCspReceipts(),
    getStoreOptions(),
    getBuyers(),
    can("stores", "create"),
    can("stores", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="CSP Receipts"
        description="Receive customer-supplied / consignment material into a store (posts receipts to the ledger)."
      />
      <CspReceiptsClient rows={rows} stores={stores} buyers={buyers} canCreate={canCreate} canExport={canExport} />
    </div>
  );
}
