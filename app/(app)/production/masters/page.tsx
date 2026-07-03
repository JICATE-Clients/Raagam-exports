import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listWorkTypes, listSewingOperations } from "@/lib/production/extras-service";
import { MastersClient } from "./masters-client";

export default async function ProductionMastersPage() {
  await requirePermission("production", "view");
  const [workTypes, operations, canCreate, canExport, canDelete] = await Promise.all([
    listWorkTypes(),
    listSewingOperations(),
    can("production", "create"),
    can("production", "export"),
    can("production", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Production Planning Masters"
        description="Work types and sewing operations used across production planning."
      />
      <MastersClient workTypes={workTypes} operations={operations} canCreate={canCreate} canExport={canExport} canDelete={canDelete} />
    </div>
  );
}
