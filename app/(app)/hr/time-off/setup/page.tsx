import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { SetupScreen } from "@/components/hr/timeoff/setup-screen";
import {
  getStageRoles,
  listDepartmentHeads,
  listHodOptions,
  listLeaveTypes,
  listYears,
  timeoffViewer,
} from "@/lib/hr/timeoff-service";

export const metadata = { title: "Time Off Setup" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const [types, years, viewer, canDelete, heads, hodOptions, stageRoles] = await Promise.all([
    listLeaveTypes(),
    listYears(),
    timeoffViewer(),
    can("hr_payroll", "delete"),
    listDepartmentHeads(),
    listHodOptions(),
    getStageRoles(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Time Off Setup"
        description="Leave types and their rules, leave years, and who approves."
      />
      <SetupScreen
        types={types}
        years={years}
        heads={heads}
        hodOptions={hodOptions}
        stageRoles={stageRoles}
        canEdit={viewer.canEdit}
        canDelete={canDelete && viewer.canEdit}
      />
    </div>
  );
}
