import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { canSeeAdjustmentValue, getAdjustmentOrderOptions, getAdjustmentStores } from "@/lib/stores/stock-adjustment-service";
import { StockAdjustmentEditor } from "../_components/stock-adjustment-editor";

export default async function NewStockAdjustmentPage() {
  await requirePermission("stores", "create");
  const [stores, orders, money, canEdit] = await Promise.all([
    getAdjustmentStores(),
    getAdjustmentOrderOptions(),
    canSeeAdjustmentValue(),
    can("stores", "edit"),
  ]);
  return (
    <StockAdjustmentEditor
      doc={null}
      lines={[]}
      stores={stores}
      orders={orders}
      initialLayers={[]}
      canSeeMoney={money}
      today={today()}
      canEdit
      canPost={canEdit}
    />
  );
}
