"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppUser } from "@/lib/auth/permission-context";
import type { Notification } from "./types";

const LIMIT = 30;

/**
 * Live notifications for the signed-in user. Fetches the latest rows, then keeps
 * them in sync via a Supabase Realtime subscription (INSERT prepends, UPDATE
 * syncs read state). A refetch on tab refocus heals any missed Realtime events.
 * Only valid inside the (app) segment (needs PermissionProvider / useAppUser).
 */
export function useNotifications() {
  const { id: userId } = useAppUser();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    setItems((data ?? []) as Notification[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`notif:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) =>
          setItems((prev) => [payload.new as Notification, ...prev].slice(0, LIMIT)),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as Notification;
          setItems((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        },
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [supabase, userId, load]);

  const unreadCount = items.reduce((n, i) => (i.read_at ? n : n + 1), 0);

  const markRead = useCallback(
    async (id: string) => {
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)),
      );
      await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("id", id)
        .is("read_at", null);
    },
    [supabase],
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .is("read_at", null);
  }, [supabase]);

  return { items, unreadCount, loading, markRead, markAllRead };
}
