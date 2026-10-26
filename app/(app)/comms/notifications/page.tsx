import { requirePermission } from "@/lib/auth/server";
import { listNotificationsPage } from "@/lib/notifications/service";
import { NotificationsList } from "@/components/comms/notifications-list";

/**
 * Messages ▸ Notifications — every alert this person has, not only the bell's
 * latest 30: approvals waiting and decided, mentions, direct messages, order
 * and T&A alerts. One table for all of them (0040); this page only reads it.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; before?: string }>;
}) {
  await requirePermission("communication", "view");
  const { filter, before } = await searchParams;
  const unreadOnly = filter === "unread";
  const page = await listNotificationsPage({ before: before ?? null, unreadOnly });
  return <NotificationsList items={page.items} next={page.next} unreadOnly={unreadOnly} paged={!!before} />;
}
