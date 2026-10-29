import Link from "next/link";
import { getActivity, getAlerts, getApprovals } from "@/lib/dashboard/service";
import type { DashboardCaps } from "@/lib/dashboard/types";
import { ActivityGroups, PanelCard } from "@/components/dashboard/lists";
import { NeedsYouCard } from "@/components/dashboard/needs-you";

/**
 * Recent activity, and the "Needs you" card (approvals + alerts).
 *
 * 2026-10-29: Alerts joined Pending approvals in one tabbed card at the top of
 * the right column, and activity moved beside the Top lists, so no panel sits
 * alone in a full-width row.
 *
 * The activity feed is built from business tables, not the audit log:
 * `record_audit` holds full row snapshots of 19 tables including payroll and is
 * RLS'd to system_admin, so widening it to everyone with a dashboard would leak
 * salaries. Reading `sales_orders` / `grns` / `production_entries` /
 * `receivables` instead means each source is already gated to its own module,
 * and the feed narrows itself to whatever the viewer may see.
 */
export async function ActivitySection({ caps }: { caps: DashboardCaps }) {
  const activity = await getActivity(caps);
  // Nothing the viewer may see: the card beside it takes the row.
  if (activity.length === 0) return null;

  return (
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
      <ActivityGroups items={activity} />
    </PanelCard>
  );
}

/**
 * Pending approvals and Alerts as one "Needs you" card (2026-10-29). Loaded
 * together, so the card decides its opening tab from both counts at once.
 */
export async function NeedsYouSection({ caps }: { caps: DashboardCaps }) {
  const [approvals, alerts] = await Promise.all([getApprovals(caps), getAlerts(caps)]);
  const canApprovals = caps.materials || caps.orders || caps.stores || caps.finance;
  return (
    <NeedsYouCard
      approvals={approvals.rows}
      approvalsTotal={approvals.total}
      canApprovals={canApprovals}
      alerts={alerts}
    />
  );
}
