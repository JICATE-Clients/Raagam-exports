import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { RequestsScreen } from "@/components/hr/timeoff/requests-screen";
import { listLeaveTypes, listRequests, listTimeoffPeople, ownRows, timeoffViewer } from "@/lib/hr/timeoff-service";
import { isOnDuty } from "@/lib/hr/timeoff-types";

export const metadata = { title: "Leave Requests" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await timeoffViewer();
  const [all, types, people] = await Promise.all([
    listRequests(["leave", "compensatory_off"]),
    listLeaveTypes(),
    listTimeoffPeople(viewer),
  ]);
  // On Duty has its own screen (/hr/time-off/on-duty).
  const rows = ownRows(all, viewer).filter((r) => !isOnDuty(r.leave_code, r.leave_name));
  return (
    <div className="space-y-4">
      <PageHeader title="Leave Requests" description="Apply for leave in advance, or book comp-off. Each request goes to its approver; approved days come off the balance." />
      {/* useOpenIntent / useCreateIntent read the URL, so the screen sits in Suspense. */}
      <Suspense>
        <RequestsScreen
          mode="leave"
          rows={rows}
          types={types}
          people={people}
          selfOnly={!!viewer.myStaffId}
          canRevoke={viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
