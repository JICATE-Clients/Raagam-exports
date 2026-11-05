import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import {
  canSeeStockValue,
  getStockTransfer,
  getTransferOrderOptions,
  getTransferStoresAndBins,
} from "@/lib/stores/stock-transfer-service";
import { loadStoreStockOwners, loadTransferLayers, loadTransferReqLines } from "@/lib/stores/stock-transfer-actions";
import { StockTransferEditor } from "../_components/stock-transfer-editor";

export default async function StockTransferPage({ params }: { params: Promise<{ transferId: string }> }) {
  await requirePermission("stores", "view");
  const { transferId } = await params;
  const found = await getStockTransfer(transferId);
  if (!found) notFound();
  const { doc } = found;
  const toOrder = doc.to_garment_order_id ?? doc.to_iwo_id;

  const [{ stores, bins, unitName }, orders, money, canEdit, layers, reqLines, owners] = await Promise.all([
    getTransferStoresAndBins(),
    getTransferOrderOptions(),
    canSeeStockValue(),
    can("stores", "edit"),
    // A draft draws on what is on hand today; a posted transfer's layers are spent.
    doc.status === "draft"
      ? loadTransferLayers(doc.from_store_id, doc.from_garment_order_id, doc.from_iwo_id, doc.transfer_date)
      : Promise.resolve({ ok: true as const, layers: [] }),
    loadTransferReqLines(toOrder),
    // Who holds stock in the From store — a draft's From Stock Of lists only those.
    doc.status === "draft" ? loadStoreStockOwners(doc.from_store_id) : Promise.resolve(null),
  ]);

  return (
    <StockTransferEditor
      doc={doc}
      lines={found.lines}
      stores={stores}
      bins={bins}
      orders={orders}
      initialLayers={layers.ok ? layers.layers : []}
      initialReqLines={reqLines.ok ? reqLines.lines : []}
      initialStoreOwners={owners && owners.ok ? { orderIds: owners.orderIds, general: owners.general } : null}
      canSeeMoney={money}
      unitName={unitName}
      today={today()}
      canEdit={canEdit}
      canPost={canEdit}
    />
  );
}
