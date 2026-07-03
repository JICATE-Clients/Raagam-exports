import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listLifecycleEvents, getEmployees } from "@/lib/hr/extras-service";
import { LifecycleClient } from "./lifecycle-client";

export default async function LifecyclePage() {
  await requirePermission("hr_payroll", "view");
  const [rows, employees, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    listLifecycleEvents(),
    getEmployees(),
    can("hr_payroll", "create"),
    can("hr_payroll", "edit"),
    can("hr_payroll", "delete"),
    can("hr_payroll", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Lifecycle Events" description="Transfers, resignations and full-&-final settlements." />
      <LifecycleClient rows={rows} employees={employees} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} canExport={canExport} />
    </div>
  );
}
