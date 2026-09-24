import { Suspense } from "react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listFines, getFineStaffOptions } from "@/lib/hr/fines-service";
import { FinesScreen } from "./fines-screen";

export const metadata = { title: "Fines & Deductions" };

export default async function FinesPage() {
  await requirePermission("hr_payroll", "view");
  const [rows, staff, canCreate, canEdit, canDelete] = await Promise.all([
    listFines(),
    getFineStaffOptions(),
    can("hr_payroll", "create"),
    can("hr_payroll", "edit"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Fines & Deductions"
        description="Staff fines — entered as a draft, confirmed, then approved by the MD or an HR Manager before payroll deducts them."
      />
      {/* useOpenIntent reads the URL, so the screen sits in a Suspense boundary. */}
      <Suspense>
        <FinesScreen rows={rows} staff={staff} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />
      </Suspense>
    </div>
  );
}
