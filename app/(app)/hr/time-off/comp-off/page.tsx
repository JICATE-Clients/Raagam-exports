import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { CompOffScreen } from "@/components/hr/timeoff/comp-off-screen";
import { listCredits, listTimeoffPeople, ownRows, timeoffViewer } from "@/lib/hr/timeoff-service";

export const metadata = { title: "Comp Off Requests" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await timeoffViewer();
  const [rows, people] = await Promise.all([listCredits(), listTimeoffPeople(viewer)]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Comp Off Requests"
        description="Claim a credit for a day worked off-schedule. HR approves it; it is then booked as leave within a month."
      />
      <Suspense>
        <CompOffScreen rows={ownRows(rows, viewer)} people={people} selfOnly={!!viewer.myStaffId} />
      </Suspense>
    </div>
  );
}
