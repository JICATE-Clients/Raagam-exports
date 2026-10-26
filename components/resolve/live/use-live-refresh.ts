"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Which tickets a screen is watching. Exactly one key: a whole unit's queue
 * (`locationId`), one ticket page (`ticketId`), or one person's own reports
 * (`reporterId`). Realtime applies `rh_tickets_select` per subscriber, so the
 * filter only narrows what RLS already allows — it is never the access check.
 */
export type LiveFilter =
  | { locationId: string }
  | { ticketId: string }
  | { reporterId: string };

export type LiveStatus = "connecting" | "live" | "reconnecting";

function filterOf(f: LiveFilter): string {
  if ("ticketId" in f) return `id=eq.${f.ticketId}`;
  if ("reporterId" in f) return `reporter_id=eq.${f.reporterId}`;
  return `location_id=eq.${f.locationId}`;
}

/** A burst of updates (a sweep, a bulk assign) lands as ONE refresh. */
const DEBOUNCE_MS = 500;
/** Same settle the bell uses after a wake, so a refocus does not race the network. */
const REFOCUS_SETTLE_MS = 1500;

/**
 * Keeps a server-rendered Resolve Hub screen current (service-desk-plan §5).
 * Any INSERT / UPDATE / DELETE on `public.rh_tickets` matching the filter
 * schedules a debounced `router.refresh()`, and returning to the tab refreshes
 * once — which heals whatever Realtime missed while the laptop slept.
 *
 * A note on a service ticket arrives here too: the notes trigger bumps the
 * ticket's `last_activity_at`, which is a row UPDATE.
 *
 * ONE CHANNEL PER MOUNTED CALLER (`useId`) — the bell's 2026-10-01 lesson:
 * supabase-js returns the SAME channel object for a repeated name, and adding
 * `.on()` to one already subscribed throws and takes the route down.
 *
 * Pass `null` to mount nothing (a screen whose filter is not known yet).
 */
export function useLiveRefresh(filter: LiveFilter | null): LiveStatus {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const instance = useId().replace(/[^A-Za-z0-9]/g, "");
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const key = filter ? filterOf(filter) : null;
  // The router object is stable in practice; a ref keeps it out of the effect's deps.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => routerRef.current.refresh(), DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`rh-live:${key}:${instance}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rh_tickets", filter: key }, refresh)
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("live");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setStatus("reconnecting");
      });

    let refocus: ReturnType<typeof setTimeout> | undefined;
    const onVisible = () => {
      clearTimeout(refocus);
      if (document.visibilityState !== "visible") return;
      refocus = setTimeout(() => routerRef.current.refresh(), REFOCUS_SETTLE_MS);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      clearTimeout(timer);
      clearTimeout(refocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [supabase, key, instance]);

  return key ? status : "connecting";
}
