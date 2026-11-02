import { Suspense } from "react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { RoundsScreen } from "@/components/hr/performance/rounds-screen";
import { listRounds, performanceViewer } from "@/lib/hr/performance-service";

export const metadata = { title: "Appraisal Rounds" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const [rows, viewer, canCreate, canDelete] = await Promise.all([
    listRounds(),
    performanceViewer(),
    can("hr_payroll", "create"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Appraisal Rounds"
        description="One appraisal period per unit. Open a round so people can rate, close self-rating when it is due, and close the round when every appraisal is approved."
      />
      <Suspense>
        <RoundsScreen
          rows={rows}
          canCreate={canCreate && viewer.canEdit}
          canEdit={viewer.canEdit}
          canDelete={canDelete && viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
