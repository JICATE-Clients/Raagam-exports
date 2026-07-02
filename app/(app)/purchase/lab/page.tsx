import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listLabStandards,
  listLabTests,
  getLabStandardOptions,
  getOrders,
  getItems,
  getVendorsForPicker,
  getBuyers,
} from "@/lib/purchase/extras-service";
import { LabClient } from "./lab-client";

export default async function LabPage() {
  await requirePermission("materials_purchase", "view");
  const [standards, tests, standardOpts, orders, items, vendors, buyers, canCreate, canEdit, canDelete] =
    await Promise.all([
      listLabStandards(),
      listLabTests(),
      getLabStandardOptions(),
      getOrders(),
      getItems(),
      getVendorsForPicker(),
      getBuyers(),
      can("materials_purchase", "create"),
      can("materials_purchase", "edit"),
      can("materials_purchase", "delete"),
    ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Lab / QC"
        description="Test standards and in-house / outside-lab test reports."
      />
      <LabClient
        standards={standards}
        tests={tests}
        standardOpts={standardOpts}
        orders={orders}
        items={items}
        vendors={vendors}
        buyers={buyers}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
