"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * WHO IS ONLINE (user 2026-11-12, artifact "Pulse Online Dot", option C):
 * a compact dot on a person's face — green while they have the ERP open and
 * are using it, an amber ring once that has sat idle for ten minutes, a grey
 * ring when no tab of theirs is open.
 *
 * Supabase Realtime PRESENCE, not a table: every signed-in tab joins one
 * channel keyed by the login's id and tracks `{ state }`. Nothing is stored,
 * so there is no migration, no "last seen", and nothing to clean up — closing
 * the last tab drops the person from the channel within seconds.
 *
 * Mounted ONCE in the app layout, so ANY ERP screen counts as online, not
 * only Pulse. A person with two tabs is online if either is active.
 *
 * The channel is a plain presence channel: any signed-in client could join it
 * and would learn which login ids are online and nothing else.
 */
export type PresenceState = "online" | "away" | "offline";

/** Ten minutes without a key, click, touch, scroll or mouse move → away. */
const AWAY_MS = 10 * 60_000;
const CHANNEL = "presence:erp";

const PresenceContext = createContext<Record<string, "online" | "away">>({});

export function PresenceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [present, setPresent] = useState<Record<string, "online" | "away">>({});

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(CHANNEL, { config: { presence: { key: userId } } });
    let state: "online" | "away" = "online";
    let last = Date.now();
    let joined = false;
    const track = () => {
      if (joined) void channel.track({ state });
    };

    channel
      .on("presence", { event: "sync" }, () => {
        const raw = channel.presenceState<{ state?: "online" | "away" }>();
        const next: Record<string, "online" | "away"> = {};
        for (const [id, metas] of Object.entries(raw)) {
          next[id] = metas.some((m) => m.state !== "away") ? "online" : "away";
        }
        setPresent(next);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          joined = true;
          track();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          joined = false;
        }
      });

    // Any sign of a person at the keyboard. Cheap: a timestamp, and a
    // track() only on the away → online edge.
    const active = () => {
      last = Date.now();
      if (state !== "online") {
        state = "online";
        track();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") active();
    };
    const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const e of EVENTS) window.addEventListener(e, active, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => {
      if (state === "online" && Date.now() - last >= AWAY_MS) {
        state = "away";
        track();
      }
    }, 30_000);

    return () => {
      clearInterval(tick);
      for (const e of EVENTS) window.removeEventListener(e, active, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return <PresenceContext.Provider value={present}>{children}</PresenceContext.Provider>;
}

export function usePresence(userId: string | null | undefined): PresenceState {
  const present = useContext(PresenceContext);
  return (userId && present[userId]) || "offline";
}

export const PRESENCE_WORD: Record<PresenceState, string> = { online: "Online", away: "Away", offline: "Offline" };

/**
 * The compact dot (artifact v2): 8px on a list face, 10px on a header face,
 * on the bottom-right edge with a 1.5px cut-out ring so it reads as part of the
 * photo. Put it inside a `relative` box that wraps the (overflow-hidden) face.
 */
export function PresenceDot({ userId, size = "sm", className }: { userId: string | null | undefined; size?: "sm" | "md"; className?: string }) {
  const state = usePresence(userId);
  if (!userId) return null;
  return (
    <span
      role="img"
      aria-label={PRESENCE_WORD[state]}
      title={PRESENCE_WORD[state]}
      className={cn(
        "pointer-events-none absolute -bottom-px -right-px box-border rounded-full ring-[1.5px] ring-surface",
        size === "md" ? "h-2.5 w-2.5" : "h-2 w-2",
        state === "online"
          ? "bg-[#1e8e3e] dark:bg-[#4cc274]"
          : state === "away"
            ? "border-[1.5px] border-[#e8a317] bg-surface"
            : "border-[1.5px] border-[#80868b] bg-surface dark:border-[#8d97a1]",
        className,
      )}
    />
  );
}

/** A face with its dot: wraps the round avatar box the caller already draws. */
export function WithPresence({ userId, size, children }: { userId: string | null | undefined; size?: "sm" | "md"; children: ReactNode }) {
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      <PresenceDot userId={userId} size={size} />
    </span>
  );
}
