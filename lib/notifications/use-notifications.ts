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

  /**
   * A NETWORK DROP IS NOT AN ERROR SCREEN (2026-09-29, screenshot 123220:
   * "TypeError: Failed to fetch" in the dev overlay). This runs on every tab
   * refocus, which is exactly the moment a laptop wakes from sleep before its
   * Wi-Fi is back — and supabase-js THROWS on a fetch that never reached the
   * server (its session refresh runs first) rather than returning `{ error }`.
   * Unhandled, that surfaced as a console TypeError on whatever screen was open.
   *
   * On any failure the list keeps what it last showed: a failed query is an
   * error, not an empty list (AGENTS.md), so blanking the bell would tell the
   * operator they have no notifications. The `online` listener below retries
   * the moment the connection returns.
   */
  const load = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (!error) setItems((data ?? []) as Notification[]);
    } catch {
      // Offline / DNS / connection reset — keep the current list.
    } finally {
      setLoading(false);
    }
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
      /*
       * AN ANNOUNCEMENT TAKEN BACK LEAVES THE OPEN BELL TOO (0676,
       * Administration ▸ System ▸ Notifications ▸ Log ▸ Take back). Without
       * this the row vanished from the table and stayed in every open tab
       * until the next refocus refetch. Realtime cannot filter a DELETE by
       * column and sends only the primary key under RLS, so this listens
       * unfiltered and drops the id if it is one of ours — any other id is
       * simply not in the list.
       */
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications" },
        (payload) => {
          const gone = (payload.old as { id?: string } | null)?.id;
          if (gone) setItems((prev) => prev.filter((n) => n.id !== gone));
        },
      )
      .subscribe();

    /*
     * WAIT A MOMENT BEFORE THE REFOCUS REFETCH (2026-09-29, screenshot 140943).
     * Coming back to the tab after a while, the one-hour access token has
     * usually expired, so this query first makes supabase-js refresh it — and
     * on a laptop just woken from sleep the network is not back yet. That
     * refresh fails inside @supabase/auth-js, whose `_handleRequest` calls
     * `console.error(e)` ITSELF before rethrowing (lib/fetch.js), so the dev
     * overlay shows "Console TypeError: Failed to fetch" pointing at `load`
     * even though `load` catches it. No try/catch of ours can reach a log the
     * library writes. What we can do is not ask during the first seconds after
     * waking: `navigator.onLine` is often already true then, while the
     * connection is not. Only the refocus is delayed; the first load is not.
     */
    let refocusTimer: ReturnType<typeof setTimeout> | undefined;
    const settleThenLoad = () => {
      clearTimeout(refocusTimer);
      refocusTimer = setTimeout(() => {
        if (document.visibilityState === "visible") void load();
      }, 3000);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        clearTimeout(refocusTimer);
        return;
      }
      settleThenLoad();
    };
    document.addEventListener("visibilitychange", onVisible);
    /*
     * Back online after a drop: fetch what arrived while Realtime was down —
     * AFTER THE SAME SETTLE (2026-09-30, screenshot 140434, the same "Failed
     * to fetch" pointing at `load`). The refocus above was delayed and this
     * was not, and `online` is the less trustworthy of the two: the browser
     * fires it when the interface comes up, before DNS and the route to
     * Supabase work, so an immediate query's token refresh failed and
     * auth-js logged it. One shared timer, so a wake that fires both events
     * loads once.
     */
    const onOnline = () => settleThenLoad();
    window.addEventListener("online", onOnline);

    return () => {
      clearTimeout(refocusTimer);
      void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [supabase, userId, load]);

  const unreadCount = items.reduce((n, i) => (i.read_at ? n : n + 1), 0);

  const markRead = useCallback(
    async (id: string) => {
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)),
      );
      // Same network-drop guard as `load`: the tick already shows read, and
      // the next successful load reconciles it with the server.
      try {
        await supabase
          .from("notifications")
          .update({ read_at: now })
          .eq("id", id)
          .is("read_at", null);
      } catch {
        /* offline — reconciled on the next load */
      }
    },
    [supabase],
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    try {
      await supabase
        .from("notifications")
        .update({ read_at: now })
        .is("read_at", null);
    } catch {
      /* offline — reconciled on the next load */
    }
  }, [supabase]);

  return { items, unreadCount, loading, markRead, markAllRead };
}
