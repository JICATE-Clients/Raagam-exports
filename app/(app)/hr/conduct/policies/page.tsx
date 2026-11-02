import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { PoliciesScreen } from "@/components/hr/conduct/policies-screen";
import { getCurrentLocationId } from "@/lib/auth/location";
import { conductViewer, listPolicies } from "@/lib/hr/conduct-service";

export const metadata = { title: "Policies" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await conductViewer();
  const [rows, locationId] = await Promise.all([
    listPolicies({ isHr: viewer.isHr, myStaffId: viewer.myStaffId }),
    getCurrentLocationId(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Policies"
        description={
          viewer.myStaffId
            ? "The company's policies that apply to you. Read each one and confirm you have."
            : "Each policy is written as a draft and published. A new version replaces the old one, and everyone it applies to acknowledges it again — themselves, or HR from a signed sheet."
        }
      />
      <Suspense>
        <PoliciesScreen rows={rows} myStaffId={viewer.myStaffId} canEdit={viewer.canEdit} locationId={locationId} />
      </Suspense>
    </div>
  );
}
