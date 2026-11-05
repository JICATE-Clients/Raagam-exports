import { can, requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentLocationId } from "@/lib/auth/location";
import { PageHeader } from "@/components/ui/page-header";
import { InventoryDashboard, type DashBin, type DashStore } from "@/components/purchase/inventory/inventory-dashboard";
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
  const asOf = readAsOf(await searchParams);
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
        />
      )}
    </div>
  );
}

/** The working unit's stores and every bin in them (RLS scopes both to the units this login holds). */
async function unitStoresAndBins(): Promise<{ stores: DashStore[]; bins: DashBin[] }> {
  const loc = await getCurrentLocationId();
  if (!loc) return { stores: [], bins: [] };
  const s = await createClient();
  const { data: stores, error } = await s.from("stores").select("id, name, store_type").eq("location_id", loc).order("name");
  if (error) throw new Error(`Stores: ${error.message}`);
  const ids = ((stores ?? []) as DashStore[]).map((x) => x.id);
  if (!ids.length) return { stores: [], bins: [] };
  const { data: bins, error: bErr } = await s.from("bins").select("id, bin_code, store_id, inactive, description").in("store_id", ids).order("bin_code");
  if (bErr) throw new Error(`Bins: ${bErr.message}`);
  return {
    stores: (stores ?? []) as DashStore[],
    bins: ((bins ?? []) as (DashBin & { inactive: boolean | null })[]).map((b) => ({ ...b, inactive: !!b.inactive })),
  };
}
