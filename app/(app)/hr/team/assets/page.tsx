import { Suspense } from "react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { AssetsScreen } from "@/components/hr/lifecycle/assets-screen";
import { lifecycleViewer, listAssets, listLifecyclePeople } from "@/lib/hr/lifecycle-service";

export const metadata = { title: "Assets Issued" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await lifecycleViewer();
  const [rows, people, canCreate, canDelete] = await Promise.all([
    listAssets(),
    listLifecyclePeople(viewer),
    can("hr_payroll", "create"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Assets Issued"
        description="Company property in each person's hands. An exit cannot clear its asset step while anything is still issued."
      />
      <Suspense>
        <AssetsScreen
          rows={rows}
          people={viewer.myStaffId ? [] : people}
          canCreate={canCreate && viewer.canEdit}
          canEdit={viewer.canEdit}
          canDelete={canDelete && viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
