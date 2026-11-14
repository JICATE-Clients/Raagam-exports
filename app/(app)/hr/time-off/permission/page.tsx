import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { RequestsScreen } from "@/components/hr/timeoff/requests-screen";
import { getWorkHours, listLeaveTypes, listRequests, listTimeoffPeople, ownRows, timeoffViewer } from "@/lib/hr/timeoff-service";

export const metadata = { title: "Permission Requests" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await timeoffViewer();
  const [rows, types, people] = await Promise.all([
    listRequests(["short_time_off"]),
    listLeaveTypes(),
    listTimeoffPeople(viewer),
  ]);
  // Each person's working day, so From / To are offered only inside it.
  const workHours = await getWorkHours(people);
  return (
    <div className="space-y-4">
      <PageHeader title="Permission Requests" description="Short time off in hours. Limits per day and per month are set on Time Off Setup." />
      {/* useOpenIntent / useCreateIntent read the URL, so the screen sits in Suspense. */}
      <Suspense>
        <RequestsScreen
          mode="permission"
          rows={ownRows(rows, viewer)}
          types={types}
          people={people}
          selfOnly={!!viewer.myStaffId}
          me={viewer.meKey}
          canRevoke={viewer.canEdit}
          workHours={workHours}
        />
      </Suspense>
    </div>
  );
}
