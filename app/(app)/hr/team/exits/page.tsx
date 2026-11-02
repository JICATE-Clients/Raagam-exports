import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { ExitsScreen } from "@/components/hr/lifecycle/exits-screen";
import { getLcSettings, lifecycleViewer, listExits, listLifecyclePeople } from "@/lib/hr/lifecycle-service";

export const metadata = { title: "Exits" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await lifecycleViewer();
  const [rows, people, settings] = await Promise.all([listExits(), listLifecyclePeople(viewer), getLcSettings()]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Exits"
        description="Resignations, retirements, terminations and other exits — each step ticked off, then the person marked as left."
      />
      <Suspense>
        <ExitsScreen
          rows={rows}
          people={people}
          noticeDays={{ staff: settings.notice_days_staff, workers: settings.notice_days_workers }}
          selfOnly={!!viewer.myStaffId}
          canEdit={viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
