import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  getNotificationOverview,
  getRetention,
  isEventKey,
  listDispatches,
  listNotificationDevices,
} from "@/lib/notifications/admin-service";
import { DISPATCH_STATUS_FILTERS, type DispatchStatus } from "@/lib/notifications/admin-types";
import { NotificationsScreen, type NotificationsTab } from "./notifications-screen";

/**
 * Administration ▸ System ▸ Notifications (doc/admin/notification-management-
 * plan.md §5): Overview (is the plumbing set up, who can be reached, which
 * alerts reach nobody — and each alert's switches and CC), Send (Test,
 * Announcement), the dispatch Log, and Devices. Each change is gated by its
 * own Administration action: Edit (switches, devices), Create (send), Delete
 * (take an announcement back).
 *
 * Everything loads in parallel — one round trip, not several — and the Log's
 * filters arrive as GET params so a filtered log is a link an admin can share.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requirePermission("system_admin", "view");
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

  // ONE round trip for the permissions and the three reads together; the
  // Log's bodies are fetched and then stripped unless the viewer may edit.
  const [canEdit, canCreate, canDelete, overview, fullLog, devices, retention] = await Promise.all([
    can("system_admin", "edit"),
    can("system_admin", "create"),
    can("system_admin", "delete"),
    getNotificationOverview(),
    listDispatches(filters, { showBody: true }),
    listNotificationDevices(),
    getRetention(),
  ]);
  const showBody = canEdit;
  const log = showBody ? fullLog : { ...fullLog, rows: fullLog.rows.map((r) => ({ ...r, body: null })) };

  const tab: NotificationsTab =
    sp.tab === "send" || sp.tab === "log" || sp.tab === "devices" || sp.tab === "settings" ? sp.tab : "overview";

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
        meId={me.id}
        perms={{ canEdit, canCreate, canDelete }}
        retention={retention}
      />
    </div>
  );
}
