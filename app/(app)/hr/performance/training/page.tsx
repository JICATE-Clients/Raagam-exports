import { Suspense } from "react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { TrainingScreen } from "@/components/hr/performance/training-screen";
import { listEnrolments, listPerformancePeople, listTrainings, performanceViewer } from "@/lib/hr/performance-service";

export const metadata = { title: "Training" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await performanceViewer();
  const [rows, enrolments, people, canCreate, canDelete] = await Promise.all([
    listTrainings(),
    listEnrolments(),
    viewer.canEdit ? listPerformancePeople(viewer) : Promise.resolve([]),
    can("hr_payroll", "create"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Training"
        description="Training sessions, who is on each, who attended and completed, and their certificates."
      />
      <Suspense>
        <TrainingScreen
          rows={rows}
          enrolments={enrolments}
          people={people}
          myStaffId={viewer.myStaffId}
          canCreate={canCreate && viewer.canEdit}
          canEdit={viewer.canEdit}
          canDelete={canDelete && viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
