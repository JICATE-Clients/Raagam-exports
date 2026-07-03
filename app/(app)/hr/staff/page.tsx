import { requirePermission, can } from "@/lib/auth/server";
import { listStaff, getLocations } from "@/lib/hr/masters-service";
import { PageHeader } from "@/components/ui/page-header";
import StaffClient from "./staff-client";

export default async function StaffPage() {
  await requirePermission("hr_payroll", "view");

  const [staff, locations, canCreate, canExport, canDelete] = await Promise.all([
    listStaff(),
    getLocations(),
    can("hr_payroll", "create"),
    can("hr_payroll", "export"),
    can("hr_payroll", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff"
        description="Manage salaried staff members."
      />
      <StaffClient
        staff={staff}
        locations={locations}
        canCreate={canCreate}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
