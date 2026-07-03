import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listMaterialExcess,
  getOrdersForPicker,
  getItems,
  getUoms,
} from "@/lib/planning/extras-service";
import { MaterialExcessClient } from "./material-excess-client";

export default async function MaterialExcessPage() {
  await requirePermission("planning", "view");
  const [rows, orders, items, uoms, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    listMaterialExcess(),
    getOrdersForPicker(),
    getItems(),
    getUoms(),
    can("planning", "create"),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Material Excess Order & Receipt"
        description="Order contingency/excess material for an order and track its receipt."
      />
      <MaterialExcessClient
        rows={rows}
        orders={orders}
        items={items}
        uoms={uoms}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
