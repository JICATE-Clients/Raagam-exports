import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  getNotificationOverview,
  isEventKey,
  listDispatches,
  listNotificationDevices,
} from "@/lib/notifications/admin-service";
import { DISPATCH_STATUS_FILTERS, type DispatchStatus } from "@/lib/notifications/admin-types";
import { NotificationsScreen, type NotificationsTab } from "./notifications-screen";

/**
 * Administration ▸ System ▸ Notifications (doc/admin/notification-management-
 * plan.md §5). Phase 1 is READ-ONLY: Overview (is the plumbing set up, who can
 * be reached, which alerts reach nobody), the dispatch Log, and Devices.
 *
 * The three reads run in parallel — one round trip, not three — and the Log's
 * filters arrive as GET params so a filtered log is a link an admin can share.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("system_admin", "view");
  const sp = await searchParams;

  const status = DISPATCH_STATUS_FILTERS.includes(sp.status as DispatchStatus)
    ? (sp.status as DispatchStatus)
    : undefined;
  const filters = {
    event: isEventKey(sp.event) ? sp.event : undefined,
    status,
    from: sp.from || undefined,
    to: sp.to || undefined,
    page: Math.max(1, Number(sp.page ?? "1") || 1),
  };

  const showBody = await can("system_admin", "edit");
  const [overview, log, devices] = await Promise.all([
    getNotificationOverview(),
    listDispatches(filters, { showBody }),
    listNotificationDevices(),
  ]);

  const tab: NotificationsTab =
    sp.tab === "log" || sp.tab === "devices" ? sp.tab : "overview";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        description="Every alert the app sends — whether it is set up to work, who it reached, and the devices alerts go to."
      />
      <NotificationsScreen
        initialTab={tab}
        overview={overview}
        log={log}
        logFilters={{
          event: filters.event ?? "",
          status: filters.status ?? "",
          from: filters.from ?? "",
          to: filters.to ?? "",
        }}
        devices={devices}
        showBody={showBody}
      />
    </div>
  );
}
