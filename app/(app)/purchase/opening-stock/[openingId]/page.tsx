import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import {
  getOpeningGroupOptions,
  getOpeningItems,
  getOpeningOrderPlan,
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
  // The saved order's plan, so the Item list is narrowed from the first render.
  const orderId = found.doc.group_kind === "re" ? found.doc.garment_order_id : found.doc.group_kind === "general" ? null : found.doc.iwo_id;
  const plan = orderId ? await getOpeningOrderPlan(orderId) : null;
  return (
    <OpeningStockEditor
      doc={found.doc}
      lines={found.lines}
      items={items}
      stores={place.stores}
      bins={place.bins}
      orders={orders}
      initialPlan={plan}
      today={today()}
      canEdit={canEdit}
      canCreateBin={canCreateBin}
    />
  );
}
