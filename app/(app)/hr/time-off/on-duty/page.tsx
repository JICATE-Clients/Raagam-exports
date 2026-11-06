import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { RequestsScreen } from "@/components/hr/timeoff/requests-screen";
import { listLeaveTypes, listRequests, listTimeoffPeople, ownRows, timeoffViewer } from "@/lib/hr/timeoff-service";
import { isOnDuty } from "@/lib/hr/timeoff-types";

export const metadata = { title: "On Duty Requests" };

/**
 * HR ▸ Time Off ▸ On Duty Requests (user 2026-11-05). On Duty is the OD leave
 * type (0798) — away on company work, so paid, drawn from no balance, and read
 * as On duty (not absent) by the dashboard. Same apply → approve flow as
 * leave, applied in advance like every time off; only the type differs.
 */
export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await timeoffViewer();
  const [all, types, people] = await Promise.all([listRequests(["leave"]), listLeaveTypes(), listTimeoffPeople(viewer)]);
  const rows = ownRows(all, viewer).filter((r) => isOnDuty(r.leave_code, r.leave_name));
  return (
    <div className="space-y-4">
      <PageHeader title="On Duty Requests" description="Apply in advance for work away from the desk — client visits, audits, outside work. Approved on duty counts as present, not as leave." />
      {/* useOpenIntent / useCreateIntent read the URL, so the screen sits in Suspense. */}
      <Suspense>
        <RequestsScreen
          mode="on_duty"
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
