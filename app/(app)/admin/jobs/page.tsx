import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listJobRuns } from "@/lib/jobs/service";
import { JobsScreen } from "./jobs-screen";

/**
 * Administration ▸ System ▸ Scheduled Jobs (doc/admin/notification-management-
 * plan.md Phase 3, 0677). Every automatic job: when it last ran, whether it is
 * LATE (past 3× its interval — the "nothing escalates and nothing looks wrong"
 * detector the SLA section of AGENTS.md asks for), and Run now.
 */
export default async function JobsPage() {
  await requirePermission("system_admin", "view");
  const [runs, canEdit, canDelete] = await Promise.all([
    listJobRuns(),
    can("system_admin", "edit"),
    can("system_admin", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Scheduled Jobs"
        description="The jobs the app runs by itself — when each last ran, whether one has stopped, and a way to run it now."
      />
      <JobsScreen runs={runs} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
