import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listAssets, getLocations } from "@/lib/admin/extras-service";
import { AssetsClient } from "./assets-client";

export default async function AssetsPage() {
  await requirePermission("system_admin", "view");
  const [rows, locations, canCreate, canExport] = await Promise.all([
    listAssets(),
    getLocations(),
    can("system_admin", "create"),
    can("system_admin", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Assets" description="Fixed-asset register with assignment (delivery/return) tracking." />
      <AssetsClient rows={rows} locations={locations} canCreate={canCreate} canExport={canExport} />
    </div>
  );
}
