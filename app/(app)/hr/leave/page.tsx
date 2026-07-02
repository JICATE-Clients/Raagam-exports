import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listLeaves, getEmployees } from "@/lib/hr/extras-service";
import { LeaveClient } from "./leave-client";

export default async function LeavePage() {
  await requirePermission("hr_payroll", "view");
  const [rows, employees, canCreate, canEdit, canApprove, canDelete] = await Promise.all([
    listLeaves(),
    getEmployees(),
    can("hr_payroll", "create"),
    can("hr_payroll", "edit"),
    can("hr_payroll", "approve"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Leave & Encashment" description="Leave applications and earned-leave encashment." />
      <LeaveClient rows={rows} employees={employees} canCreate={canCreate} canEdit={canEdit} canApprove={canApprove} canDelete={canDelete} />
    </div>
  );
}
