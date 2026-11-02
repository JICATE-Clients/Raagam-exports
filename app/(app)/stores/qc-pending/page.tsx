import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getGrnStoresAndBins, listPendingQcLines } from "@/lib/purchase/grn-service";
import { QcPendingClient } from "./qc-pending-client";

/**
 * STORES ▸ PENDING QC (0791, user 2026-11-02). Goods posted on a GRN with QC = Pending
 * sit here — counted against their PO, but in no stock, no bin and on no bill — until the
 * inspector decides: Passed qty goes to the bin chosen here and is billed, Failed qty goes
 * back on a Rejection or Replacement DC.
 */
export default async function QcPendingPage() {
  await requirePermission("stores", "view");
  const [lines, { stores, bins, defaultStoreId }, canDecide, canDecidePurchase, canCreateBin] = await Promise.all([
    listPendingQcLines(),
    getGrnStoresAndBins(),
    can("stores", "edit"),
    can("materials_purchase", "edit"),
    can("masters", "create"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Pending QC"
        description="Goods received on a GRN and waiting for inspection — not in stock until passed."
      />
      <QcPendingClient
        lines={lines}
        stores={stores}
        bins={bins}
        defaultStoreId={defaultStoreId}
        canDecide={canDecide || canDecidePurchase}
        canCreateBin={canCreateBin}
      />
    </div>
  );
}
