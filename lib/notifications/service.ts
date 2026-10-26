import "server-only";
import { createClient } from "@/lib/supabase/server";
import { decodeCursor, encodeCursor } from "@/lib/comms/types";
import type { Notification } from "./types";

/** The current user's most recent notifications (RLS-scoped to auth.uid()).
 *
 *  created-by: exempt -- the bell menu, not a record listing. A notification is
 *  raised BY THE SYSTEM for one reader, and RLS already scopes the list to
 *  `auth.uid()`, so "who created it" is either nobody or the person reading it. */
export async function listNotifications(limit = 30): Promise<Notification[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Notification[];
}

/** Count of the current user's unread notifications. */
export async function getUnreadCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

/**
 * One page of the current user's notifications for the full Notifications
 * screen (0746) — the bell shows the latest 30; this shows them all.
 * Keyset-paged on (created_at, id), newest first, so a new arrival never shifts
 * the page being read. RLS (notifications_select_own) scopes it to auth.uid().
 *
 * A failed query THROWS — an inbox that silently reads empty is believed.
 *
 * created-by: exempt -- the reader's own inbox, raised by the system for them (see listNotifications above).
 */
export async function listNotificationsPage(opts: {
  before?: string | null;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<{ items: Notification[]; next: string | null }> {
  const size = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const cur = decodeCursor(opts.before);
  if (opts.before && !cur) return { items: [], next: null };
  const supabase = await createClient();
  let q = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);
  if (opts.unreadOnly) q = q.is("read_at", null);
  // Both values were shape-checked by decodeCursor before they reach the filter.
  if (cur) q = q.or(`created_at.lt."${cur.created_at}",and(created_at.eq."${cur.created_at}",id.lt.${cur.id})`);
  const { data, error } = await q;
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  const rows = (data ?? []) as Notification[];
  const more = rows.length > size;
  const items = more ? rows.slice(0, size) : rows;
  const last = items[items.length - 1];
  return { items, next: more && last ? encodeCursor(last.created_at, last.id) : null };
}
