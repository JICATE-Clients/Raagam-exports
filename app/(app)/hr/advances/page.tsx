import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listAdvances, getEmployees } from "@/lib/hr/extras-service";
import { AdvancesClient } from "./advances-client";

export default async function AdvancesPage() {
  await requirePermission("hr_payroll", "view");
  const [rows, employees, canCreate, canEdit, canDelete] = await Promise.all([
    listAdvances(),
    getEmployees(),
    can("hr_payroll", "create"),
    can("hr_payroll", "edit"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Advances" description="Employee advances with repayment tracking." />
      <AdvancesClient rows={rows} employees={employees} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
