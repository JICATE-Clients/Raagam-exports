import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listProcessAllocations,
  getOrdersForPicker,
  getVendors,
  getUoms,
} from "@/lib/planning/extras-service";
import { ProcessAllocationsClient } from "./process-allocations-client";

export default async function ProcessAllocationsPage() {
  await requirePermission("planning", "view");
  const [rows, orders, vendors, uoms, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    listProcessAllocations(),
    getOrdersForPicker(),
    getVendors(),
    getUoms(),
    can("planning", "create"),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Process Allocation"
        description="Allocate an order's outsourced process to a vendor with qty and rate before purchasing."
      />
      <ProcessAllocationsClient
        rows={rows}
        orders={orders}
        vendors={vendors}
        uoms={uoms}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
