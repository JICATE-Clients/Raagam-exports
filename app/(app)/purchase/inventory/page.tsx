import { can, requirePermission } from "@/lib/auth/server";
import { unitStoresAndBins } from "@/lib/stores/unit-layout";
import { PageHeader } from "@/components/ui/page-header";
import { InventoryDashboard } from "@/components/purchase/inventory/inventory-dashboard";
import { inventoryDashboard } from "@/lib/reports/stock-statement-service";
import { readAsOf, currentUnitName } from "@/lib/reports/stock-statement-page";

/**
 * PURCHASE ▸ PURCHASE STORE ▸ OVERVIEW (user 2026-11-04; was "Inventory Dashboard", renamed and made
 * the group's first row the same day) — where the stock is, what it
 * is, what it is worth and what needs doing, drawn as the store's own racks. Purchase OR Stores may
 * open it; what it SHOWS is the database's call (`inventoryDashboard`): values for a holder of the
 * Stock Statement with Value screen, quantities for anyone with Reports, otherwise a sentence.
 *
 * The racks need EVERY bin of the unit's stores, empty ones too, so they come from the Bin master
 * here rather than from the stock rows (which only name bins that hold something).
 */
export default async function InventoryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [purchaseView, storesView] = await Promise.all([can("materials_purchase", "view"), can("stores", "view")]);
  if (!purchaseView && !storesView) await requirePermission("materials_purchase", "view");
  const sp = await searchParams;
  const asOf = readAsOf(sp);
  const initialStoreId = typeof sp.store === "string" ? sp.store : null;
  const [read, unit, layout, canCreate, canEdit] = await Promise.all([
    inventoryDashboard(asOf),
    currentUnitName(),
    unitStoresAndBins(),
    can("stores", "create"),
    can("stores", "edit"),
  ]);
  return (
    <div className="space-y-3">
      <PageHeader title="Overview" description="Every bin of the store — what is in it, what it has seen, and what it needs — live from every GRN, transfer and issue" />
      {read.access === "none" ? (
        <p className="rounded-lg border border-border bg-surface-muted p-4 text-sm text-muted-foreground">
          Stock figures come from the Stock Statement reports, and this login has no Reports access. Ask an admin to grant
          Reports ▸ Stock Statement (quantities) or Stock Statement with Value (quantities and value).
        </p>
      ) : (
        <InventoryDashboard
          rows={read.rows}
          bins={layout.bins}
          stores={layout.stores}
          asOf={asOf}
          unit={unit}
          withValue={read.access === "value"}
          // Assign a bin posts a Stock Transfer: stock_transfer_post needs stores:edit, the draft stores:create.
          canMove={canCreate && canEdit}
          initialStoreId={initialStoreId}
        />
      )}
    </div>
  );
}
