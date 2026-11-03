import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { getOpeningGroupOptions, getOpeningItems, getOpeningStoresAndBins } from "@/lib/stores/opening-stock/service";
import { OpeningStockEditor } from "../_components/opening-stock-editor";

export default async function NewOpeningStockPage() {
  await requirePermission("stores", "create");
  const [items, place, orders, canEdit, canCreateBin] = await Promise.all([
    getOpeningItems(),
    getOpeningStoresAndBins(),
    getOpeningGroupOptions(),
    can("stores", "edit"),
    can("masters", "create"),
  ]);
  return (
    <OpeningStockEditor
      doc={null}
      lines={[]}
      items={items}
      stores={place.stores}
      bins={place.bins}
      orders={orders}
      today={today()}
      canEdit={canEdit}
      canCreateBin={canCreateBin}
    />
  );
}
