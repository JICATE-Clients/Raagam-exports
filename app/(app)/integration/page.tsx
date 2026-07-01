import { requirePermission } from "@/lib/auth/server";
import {
  getPendingApprovals,
  getCrisisItems,
  listExports,
} from "@/lib/integration/service";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { IntegrationTabs } from "./integration-tabs";

export default async function IntegrationPage() {
  await requirePermission("integration", "view");

  const [approvals, crisisItems, recentExports] = await Promise.all([
    getPendingApprovals(),
    getCrisisItems(),
    listExports(),
  ]);

  const dangerCount = crisisItems.filter((c) => c.severity === "danger").length;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="System Integration"
        description="Unified management dashboard — pending approvals, daily crisis summary, and Tally exports."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Pending Approvals"
          value={approvals.length}
          tone={approvals.length > 0 ? "warning" : "neutral"}
        />
        <Stat
          label="Crisis Items"
          value={crisisItems.length}
          hint={dangerCount > 0 ? `${dangerCount} critical` : undefined}
          tone={crisisItems.length > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Recent Exports"
          value={recentExports.length}
          tone="neutral"
        />
      </div>

      <IntegrationTabs
        approvals={approvals}
        crisisItems={crisisItems}
        recentExports={recentExports.slice(0, 5)}
      />
    </div>
  );
}
