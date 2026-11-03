import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import {
  getOpeningGroupOptions,
  getOpeningItems,
  getOpeningStock,
  getOpeningStoresAndBins,
} from "@/lib/stores/opening-stock/service";
import { OpeningStockEditor } from "../_components/opening-stock-editor";

export default async function OpeningStockPage({ params }: { params: Promise<{ openingId: string }> }) {
  await requirePermission("stores", "view");
  const { openingId } = await params;
  const [found, items, place, orders, canEdit, canCreateBin] = await Promise.all([
    getOpeningStock(openingId),
    getOpeningItems(),
    getOpeningStoresAndBins(),
    getOpeningGroupOptions(),
    can("stores", "edit"),
    can("masters", "create"),
  ]);
  if (!found) notFound();
  return (
    <OpeningStockEditor
      doc={found.doc}
      lines={found.lines}
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
