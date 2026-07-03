import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listCouriers,
  listCourierDespatches,
  getCourierOptions,
} from "@/lib/admin/extras-service";
import { CouriersClient } from "./couriers-client";

export default async function CouriersPage() {
  await requirePermission("system_admin", "view");
  const [couriers, despatches, courierOpts, canCreate, canEdit, canExport, canDelete] = await Promise.all([
    listCouriers(),
    listCourierDespatches(),
    getCourierOptions(),
    can("system_admin", "create"),
    can("system_admin", "edit"),
    can("system_admin", "export"),
    can("system_admin", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Courier" description="Courier companies, despatches, invoices and proof-of-delivery." />
      <CouriersClient
        couriers={couriers}
        despatches={despatches}
        courierOpts={courierOpts}
        canCreate={canCreate}
        canEdit={canEdit}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
