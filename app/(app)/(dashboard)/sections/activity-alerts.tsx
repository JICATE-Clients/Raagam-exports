import Link from "next/link";
import { getActivity, getAlerts } from "@/lib/dashboard/service";
import type { DashboardCaps } from "@/lib/dashboard/types";
import { AlertList, PanelCard, TimelineList } from "@/components/dashboard/lists";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";

/**
 * Section 04b — recent activity beside the alert list.
 *
 * The activity feed is built from business tables, not the audit log:
 * `record_audit` holds full row snapshots of 19 tables including payroll and is
 * RLS'd to system_admin, so widening it to everyone with a dashboard would leak
 * salaries. Reading `sales_orders` / `grns` / `production_entries` /
 * `receivables` instead means each source is already gated to its own module,
 * and the feed narrows itself to whatever the viewer may see.
 *
 * When that leaves the timeline empty for a given user, Alerts takes the full
 * width rather than sitting next to a blank panel.
 */
export async function ActivityAndAlerts({ caps }: { caps: DashboardCaps }) {
  const [activity, alerts] = await Promise.all([getActivity(caps), getAlerts(caps)]);

  const showActivity = activity.length > 0;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        showActivity &&
          "lg:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]",
      )}
    >
      {showActivity && (
        <PanelCard
          title="Recent activity"
          aside={
            caps.systemAdmin ? (
              <Link href="/admin/audit" className="text-xs text-primary hover:underline">
                Audit log →
              </Link>
            ) : undefined
          }
        >
          <TimelineList items={activity} />
        </PanelCard>
      )}

      <PanelCard
        title="Alerts"
        aside={
          alerts.length > 0 ? (
            <StatusPill tone="danger" className="shrink-0">
              {alerts.length} active
            </StatusPill>
          ) : undefined
        }
      >
        <AlertList items={alerts} />
      </PanelCard>
    </div>
  );
}
