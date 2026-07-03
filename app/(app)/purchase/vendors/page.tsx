import { requirePermission, can } from "@/lib/auth/server";
import { listVendors } from "@/lib/purchase/po-service";
import { PageHeader } from "@/components/ui/page-header";
import { VendorsClient } from "./vendors-client";

export default async function VendorsPage() {
  await requirePermission("materials_purchase", "view");

  const [vendors, canCreate, canEdit, canExport, canDelete] = await Promise.all([
    listVendors(),
    can("materials_purchase", "create"),
    can("materials_purchase", "edit"),
    can("materials_purchase", "export"),
    can("materials_purchase", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendors"
        description="Vendor master — yarn, knitting, dyeing, trims, packing."
      />
      <VendorsClient
        vendors={vendors}
        canCreate={canCreate}
        canEdit={canEdit}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
