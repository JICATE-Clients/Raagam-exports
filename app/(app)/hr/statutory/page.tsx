import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listStatutoryDocs, getEmployees } from "@/lib/hr/extras-service";
import { StatutoryClient } from "./statutory-client";

export default async function StatutoryPage() {
  await requirePermission("hr_payroll", "view");
  const [rows, employees, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    listStatutoryDocs(),
    getEmployees(),
    can("hr_payroll", "create"),
    can("hr_payroll", "edit"),
    can("hr_payroll", "delete"),
    can("hr_payroll", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Statutory Documents" description="ESI Forms 3 / 5 / 10 and strength corrections." />
      <StatutoryClient rows={rows} employees={employees} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} canExport={canExport} />
    </div>
  );
}
