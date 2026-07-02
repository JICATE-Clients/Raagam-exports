import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listCompEvents, getEmployees } from "@/lib/hr/extras-service";
import { CompEventsClient } from "./comp-events-client";

export default async function CompEventsPage() {
  await requirePermission("hr_payroll", "view");
  const [rows, employees, canCreate, canApprove, canDelete] = await Promise.all([
    listCompEvents(),
    getEmployees(),
    can("hr_payroll", "create"),
    can("hr_payroll", "approve"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Bonus & Increments" description="Compensation events (bonus / increment) with approval." />
      <CompEventsClient rows={rows} employees={employees} canCreate={canCreate} canApprove={canApprove} canDelete={canDelete} />
    </div>
  );
}
