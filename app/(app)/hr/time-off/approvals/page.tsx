import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { ApprovalsScreen } from "@/components/hr/timeoff/approvals-screen";
import { getTimeoffQueue } from "@/lib/hr/timeoff-service";

export const metadata = { title: "Time Off Approvals" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const items = await getTimeoffQueue();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Time Off Approvals"
        description="Leave, permissions, comp-off claims and encashments waiting for a decision. Tick several to decide them together."
      />
      <Suspense>
        <ApprovalsScreen items={items} />
      </Suspense>
    </div>
  );
}
