import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { EncashmentScreen } from "@/components/hr/timeoff/encashment-screen";
import { listEncashments, listLeaveTypes, listTimeoffPeople, timeoffViewer } from "@/lib/hr/timeoff-service";

export const metadata = { title: "Leave Encashment" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await timeoffViewer();
  const [rows, types, people] = await Promise.all([listEncashments(), listLeaveTypes(), listTimeoffPeople(viewer)]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Leave Encashment"
        description="Turn unused leave into pay. Checked against the balance, approved, then marked paid."
      />
      <Suspense>
        <EncashmentScreen
          rows={rows}
          types={types}
          people={people}
          selfOnly={!!viewer.myStaffId}
          canPay={viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
