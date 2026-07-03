import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Notification } from "./types";

/** The current user's most recent notifications (RLS-scoped to auth.uid()). */
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
