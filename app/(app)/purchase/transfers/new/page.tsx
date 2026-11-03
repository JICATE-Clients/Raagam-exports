import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import {
  canSeeStockValue,
  getTransferOrderOptions,
  getTransferStoresAndBins,
} from "@/lib/stores/stock-transfer-service";
import { StockTransferEditor } from "../_components/stock-transfer-editor";

export default async function NewStockTransferPage() {
  await requirePermission("stores", "create");
  const [{ stores, bins, unitName }, orders, money, canEdit] = await Promise.all([
    getTransferStoresAndBins(),
    getTransferOrderOptions(),
    canSeeStockValue(),
    can("stores", "edit"),
  ]);
  return (
    <StockTransferEditor
      doc={null}
      lines={[]}
      stores={stores}
      bins={bins}
      orders={orders}
      initialLayers={[]}
      initialReqLines={[]}
      canSeeMoney={money}
      unitName={unitName}
      today={today()}
      canEdit
      canPost={canEdit}
    />
  );
}
