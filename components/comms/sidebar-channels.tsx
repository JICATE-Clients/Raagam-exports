"use client";

import type { MouseEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { Compass, Hash, Lock, Pin, PinOff, Plus, RotateCw } from "lucide-react";
import { SidebarItem } from "@/components/navigation/SidebarItem";
import { useToast } from "@/components/ui/toast";
import { loadSidebarChannels, setConversationPrefs } from "@/lib/comms/channel-actions";
import { sortSidebar, type SidebarChannel } from "@/lib/comms/channels";
import { cn } from "@/lib/utils";

/** Fired after anything that changes the caller's channel list (create, join,
 *  leave, archive, pin): the sidebar lives in the app shell, outside the
 *  routes a server action revalidates, so it re-reads on this instead. */
export const CHANNELS_CHANGED = "comms:channels-changed";
export function announceChannelsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANNELS_CHANGED));
}

/**
 * The caller's channels in the comms sidebar (0751): one fold of the module's
 * accordion (ContextSidebar), pinned first in the order pinned, then by name.
 *
 * Unread counts are `comm_sidebar_channels()`'s — the persisted read state
 * 0737 already keeps, never counted here. The list re-reads on a route change
 * (opening a channel marks it read), on `comms:channels-changed`, and when the
 * tab comes back into view.
 *
 * Pinning is personal: it writes the caller's own membership row and nobody
 * else sees it. The pin control is a sibling of the row's link, not inside it,
 * so a click on it never navigates.
 */
export function SidebarChannels({
  pathname,
  canCreate,
  navigate,
}: {
  pathname: string;
  canCreate: boolean;
  navigate: (href: string, title: string) => (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<SidebarChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void loadSidebarChannels().then((r) => {
      if (r.ok) {
        setRows(r.rows);
        setError(null);
      } else setError(r.error);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load, pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener(CHANNELS_CHANGED, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(CHANNELS_CHANGED, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  function togglePin(c: SidebarChannel) {
    const pinned = !c.pinned_at;
    // Optimistic, then re-read: the order is the server's.
    setRows((prev) =>
      prev ? sortSidebar(prev.map((r) => (r.id === c.id ? { ...r, pinned_at: pinned ? new Date().toISOString() : null } : r))) : prev,
    );
    void setConversationPrefs({ conversation_id: c.id, pinned }).then((r) => {
      if (!r.ok) toast.error(r.error);
      load();
    });
  }

  return (
    <div className="space-y-0.5">
      {rows === null && !error && (
        <p className="px-3 py-1 text-xs text-muted-foreground" aria-busy="true">
          Loading channels…
        </p>
      )}
      {error && (
        <p className="flex items-center gap-1 px-3 py-1 text-xs text-danger" role="alert">
          {error}
          <button type="button" onClick={load} className="rounded p-0.5 hover:bg-surface-muted" aria-label="Retry loading channels">
            <RotateCw className="h-3 w-3" />
          </button>
        </p>
      )}
      {rows?.length === 0 && <p className="px-3 py-1 text-xs text-muted-foreground">You have not joined any channels yet.</p>}

      {rows?.map((c) => {
        const href = `/comms/c/${c.id}`;
        const active = pathname === href;
        const unread = c.notify_level === "none" ? 0 : c.unread_count;
        return (
          <div key={c.id} className="group/ch relative flex items-center">
            <SidebarItem
              href={href}
              label={c.name}
              active={active}
              icon={
                c.visibility === "private" ? (
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-label="Private" />
                ) : (
                  <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )
              }
              trailing={
                c.mention_count > 0 ? (
                  <span className="rounded-full bg-danger-soft px-1.5 text-[10px] font-semibold text-danger" aria-label={`${c.mention_count} mentions`}>
                    @{c.mention_count}
                  </span>
                ) : unread > 0 ? (
                  <span className="rounded-full bg-primary-soft px-1.5 text-[10px] font-semibold text-primary" aria-label={`${unread} unread`}>
                    {unread}
                  </span>
                ) : null
              }
              className={cn(
                "h-8 w-full rounded-[10px] px-3 py-0 pr-8 text-[13px]",
                !active && (unread > 0 ? "font-semibold text-foreground" : "text-foreground"),
              )}
              onClick={navigate(href, `#${c.name}`)}
            />
            <button
              type="button"
              onClick={() => togglePin(c)}
              aria-label={c.pinned_at ? `Unpin #${c.name}` : `Pin #${c.name}`}
              title={c.pinned_at ? "Unpin" : "Pin to top"}
              className={cn(
                "absolute right-1 rounded p-1 hover:bg-surface-muted focus-visible:opacity-100",
                active ? "text-primary-foreground" : "text-muted-foreground",
                c.pinned_at ? "opacity-100" : "opacity-0 group-hover/ch:opacity-100",
              )}
            >
              {c.pinned_at ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            </button>
          </div>
        );
      })}

      <SidebarItem
        href="/comms/channels"
        label="Browse channels"
        icon={<Compass className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        active={pathname === "/comms/channels"}
        className="h-8 w-full rounded-[10px] px-3 py-0 text-[13px]"
        onClick={navigate("/comms/channels", "Channels")}
      />
      {canCreate && (
        <SidebarItem
          href="/comms/channels?create=1"
          label="New channel"
          icon={<Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          className="h-8 w-full rounded-[10px] px-3 py-0 text-[13px]"
          onClick={navigate("/comms/channels?create=1", "Channels")}
        />
      )}
    </div>
  );
}
