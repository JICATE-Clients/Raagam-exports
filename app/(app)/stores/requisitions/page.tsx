import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listRequisitions, getStoreOptions } from "@/lib/stores/extras-service";
import { RequisitionsClient } from "./requisitions-client";

export default async function RequisitionsPage() {
  await requirePermission("stores", "view");
  const [rows, stores, canCreate, canExport] = await Promise.all([
    listRequisitions(),
    getStoreOptions(),
    can("stores", "create"),
    can("stores", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Material Requisition Slips"
        description="Department requests for material from a store; approve then issue (posts to the ledger)."
      />
      <RequisitionsClient rows={rows} stores={stores} canCreate={canCreate} canExport={canExport} />
    </div>
  );
}
