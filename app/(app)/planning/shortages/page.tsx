import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listShortages,
  getOrdersForPicker,
  getItems,
  getUoms,
} from "@/lib/planning/shortage-service";
import { ShortagesClient } from "./shortages-client";

export default async function ShortagesPage() {
  await requirePermission("planning", "view");

  const [shortages, orders, items, uoms, canCreate, canEdit, canApprove, canDelete, canExport] =
    await Promise.all([
      listShortages(),
      getOrdersForPicker(),
      getItems(),
      getUoms(),
      can("planning", "create"),
      can("planning", "edit"),
      can("planning", "approve"),
      can("planning", "delete"),
      can("planning", "export"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material & Garment Shortages"
        description="Flag a required-vs-available gap on an order, then submit for approval and resolution."
      />
      <ShortagesClient
        shortages={shortages}
        orders={orders}
        items={items}
        uoms={uoms}
        canCreate={canCreate}
        canEdit={canEdit}
        canApprove={canApprove}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
