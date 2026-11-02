import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { RequestsScreen } from "@/components/hr/timeoff/requests-screen";
import { listLeaveTypes, listRequests, listTimeoffPeople, timeoffViewer } from "@/lib/hr/timeoff-service";

export const metadata = { title: "Permissions" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await timeoffViewer();
  const [rows, types, people] = await Promise.all([
    listRequests(["short_time_off"]),
    listLeaveTypes(),
    listTimeoffPeople(viewer),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Permissions" description="Short time off in hours. Limits per day and per month are set on Leave Setup." />
      {/* useOpenIntent / useCreateIntent read the URL, so the screen sits in Suspense. */}
      <Suspense>
        <RequestsScreen
          mode="permission"
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
