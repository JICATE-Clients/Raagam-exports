import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listOpeningStocks, getStoreOptions } from "@/lib/stores/extras-service";
import { OpeningStockClient } from "./opening-stock-client";

export default async function OpeningStockPage() {
  await requirePermission("stores", "view");
  const [rows, stores, canCreate, canExport] = await Promise.all([
    listOpeningStocks(),
    getStoreOptions(),
    can("stores", "create"),
    can("stores", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Opening Stock"
        description="Set a store's initial on-hand balances; posting writes adjust-in entries to the ledger."
      />
      <OpeningStockClient rows={rows} stores={stores} canCreate={canCreate} canExport={canExport} />
    </div>
  );
}
