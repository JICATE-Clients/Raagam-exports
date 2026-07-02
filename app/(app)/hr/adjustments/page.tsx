import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listAdjustments, getEmployees } from "@/lib/hr/extras-service";
import { AdjustmentsClient } from "./adjustments-client";

export default async function AdjustmentsPage() {
  await requirePermission("hr_payroll", "view");
  const [rows, employees, canCreate, canEdit, canDelete] = await Promise.all([
    listAdjustments(),
    getEmployees(),
    can("hr_payroll", "create"),
    can("hr_payroll", "edit"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Allowances & Deductions" description="Recurring or one-off pay allowances and deductions per employee." />
      <AdjustmentsClient rows={rows} employees={employees} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
