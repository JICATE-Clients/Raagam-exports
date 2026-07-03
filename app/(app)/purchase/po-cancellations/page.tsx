import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPoCancellations, getCancellablePos } from "@/lib/purchase/extras-service";
import { PoCancellationsClient } from "./po-cancellations-client";

export default async function PoCancellationsPage() {
  await requirePermission("materials_purchase", "view");
  const [rows, pos, canEdit, canExport] = await Promise.all([
    listPoCancellations(),
    getCancellablePos(),
    can("materials_purchase", "edit"),
    can("materials_purchase", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Cancel Purchase Order"
        description="Cancel an open purchase order with a logged reason."
      />
      <PoCancellationsClient rows={rows} pos={pos} canEdit={canEdit} canExport={canExport} />
    </div>
  );
}
