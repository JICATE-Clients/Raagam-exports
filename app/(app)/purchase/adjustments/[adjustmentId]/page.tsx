import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import {
  canSeeAdjustmentValue,
  getAdjustmentOrderOptions,
  getAdjustmentStores,
  getStockAdjustment,
} from "@/lib/stores/stock-adjustment-service";
import { loadAdjustmentLayers } from "@/lib/stores/stock-adjustment-actions";
import { StockAdjustmentEditor } from "../_components/stock-adjustment-editor";

export default async function StockAdjustmentPage({ params }: { params: Promise<{ adjustmentId: string }> }) {
  await requirePermission("stores", "view");
  const { adjustmentId } = await params;
  const found = await getStockAdjustment(adjustmentId);
  if (!found) notFound();
  const { doc } = found;

  const [stores, orders, money, canEdit, layers] = await Promise.all([
    getAdjustmentStores(),
    getAdjustmentOrderOptions(),
    canSeeAdjustmentValue(),
    can("stores", "edit"),
    // A draft adjusts what is on hand; a posted adjustment shows what it did.
    doc.status === "draft"
      ? loadAdjustmentLayers(doc.store_id, doc.garment_order_id, doc.iwo_id, doc.stock_type, doc.adjustment_date)
      : Promise.resolve({ ok: true as const, layers: [] }),
  ]);

  return (
    <StockAdjustmentEditor
      doc={doc}
      lines={found.lines}
      stores={stores}
      orders={orders}
      initialLayers={layers.ok ? layers.layers : []}
      canSeeMoney={money}
      today={today()}
      canEdit={canEdit}
      canPost={canEdit}
    />
  );
}
