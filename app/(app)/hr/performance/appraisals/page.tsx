import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { AppraisalsScreen } from "@/components/hr/performance/appraisals-screen";
import { listPerformancePeople, listReviews, listRounds, performanceViewer } from "@/lib/hr/performance-service";

export const metadata = { title: "Appraisals" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await performanceViewer();
  const [rounds, rows, people] = await Promise.all([
    listRounds(),
    listReviews(),
    viewer.canEdit ? listPerformancePeople(viewer) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Appraisals"
        description="Each person rates themself, their supervisor rates them, and the approver signs it off. Workers are rated by their supervisor directly; HR can enter either rating from the paper sheet."
      />
      {/* useOpenIntent reads the URL, so the screen sits in Suspense. */}
      <Suspense>
        <AppraisalsScreen rounds={rounds} rows={rows} people={people} myStaffId={viewer.myStaffId} canEdit={viewer.canEdit} />
      </Suspense>
    </div>
  );
}
