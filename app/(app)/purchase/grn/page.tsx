import { can, requirePermission } from "@/lib/auth/server";
import { hasPermission } from "@/lib/auth/types";
import {
  getGrnReceivingLocations,
  getGrnStoresAndBins,
  getOpenPoLines,
  getReplacementsDue,
  listGrns,
} from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { GrnScreen } from "./_components/grn-screen";

/**
 * PURCHASE ▸ RECEIVING ▸ GOODS RECEIPTS — the Receiving screen (doc/purchase/grn.md §1,
 * grn-plan.md Phase 2). Pending POs, posted and draft GRNs, and the entry opened from a
 * row. Everything loads in one round: the open PO lines come back already carrying the
 * order, buyer and class the filters read (0778).
 */
export default async function GrnListPage() {
  const user = await requirePermission("materials_purchase", "view");
  const [openPoLines, grns, replacements, receiving, place, canCreateBin] = await Promise.all([
    getOpenPoLines(),
    listGrns(),
    getReplacementsDue(),
    getGrnReceivingLocations(),
    getGrnStoresAndBins(),
    can("masters", "create"),
  ]);

  return (
    /* NO FLOATING "← Back" OVER THE OPEN GRN ENTRY (user 2026-11-02, screenshot 3961) — Raise
       PO's rule: the entry is one full-width frame, its Cancel is the way out. */
    <div className="space-y-4 [&:has([data-grn-editor])>[data-focus-region=header]>div]:hidden">
      <PageHeader
        title="Goods Receipt Notes"
        description="Pick a pending PO, type what arrived and where it was put. Post it to book the stock."
      />
      <GrnScreen
        openPoLines={openPoLines}
        grns={grns}
        replacements={replacements}
        locations={receiving.options}
        defaultLocationId={receiving.defaultId}
        // `stores:approve` is the Store Manager key — the one that may authorise an
        // over-receipt. createGrn and the 0620 trigger re-check.
        canCreate={hasPermission(user, "materials_purchase", "create")}
        stores={place.stores}
        bins={place.bins}
        defaultStoreId={place.defaultStoreId}
        processOrders={place.processOrders}
        processors={place.processors}
        canCreateBin={canCreateBin}
      />
    </div>
  );
}
