"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { Bell, CheckCheck, X } from "lucide-react";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { PushToggle } from "@/components/pwa/push-toggle";
import { NotificationRow } from "@/components/notifications/notification-row";
import { notificationDay } from "@/lib/notifications/look";
import { useModalGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";

/** `onDark`: the trigger sits on the phone home's blue band (2026-11-04), so it is white. */
export function NotificationsBell({ onDark = false }: { onDark?: boolean } = {}) {
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  // PHONE: the panel was anchored to the bell's RIGHT edge, and on a phone the
  // bell is not the last thing in the bar ("+ New" follows it), so the panel
  // ran off the LEFT of the screen and every line was cut (user 2026-11-10).
  // Below md it is now a full-width sheet 8px in from both edges, starting just
  // under the bell — measured on click, since the bar is taller on the phone
  // home's blue band than elsewhere. md and up keep the dropdown unchanged.
  const [top, setTop] = useState(64);
  useModalGuard(open);
  // Module grain on purpose: the bell sits on every screen, and the screen in
  // view belongs to some other module, so a screen-aware check would ask the
  // wrong question.
  const canOpenAll = hasPermission(useAppUser(), "communication", "view");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          setTop(Math.round(e.currentTarget.getBoundingClientRect().bottom) + 6);
          setOpen((o) => !o);
        }}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-control",
          onDark ? "bg-white/12 text-white hover:bg-white/20" : "text-muted-foreground hover:bg-surface-muted",
        )}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className={onDark ? "h-[18px] w-[18px]" : "h-4 w-4"} />
        {unreadCount > 0 && (
          <span className={cn("absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white", onDark && "ring-2 ring-[#0a2e4d]")}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10 bg-black/30 md:bg-transparent" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Notifications"
            style={{ "--bell-top": `${top}px` } as CSSProperties}
            className={cn(
              "fixed inset-x-2 bottom-4 top-[var(--bell-top)] z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg",
              "md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-1 md:w-[24rem] md:rounded-lg",
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <span className="text-[15px] font-semibold text-heading">Notifications</span>
              <span className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllRead()}
                    className="flex h-8 items-center gap-1 rounded-control px-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                )}
                {/* A phone has no "click outside" that feels like closing, so it gets a ✕. */}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="flex h-8 w-8 items-center justify-center rounded-control text-muted-foreground hover:bg-surface-muted md:hidden"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto md:max-h-[28rem] md:flex-none">
              {loading ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No notifications yet.
                </p>
              ) : (
                /* DAY HEADINGS (Today · Yesterday · DD/MM/YYYY): the list is newest
                   first, so a heading is drawn wherever the day changes. */
                items.map((n, i) => {
                  const day = notificationDay(n.created_at);
                  const heading =
                    i === 0 || day !== notificationDay(items[i - 1].created_at) ? (
                      <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {day}
                      </p>
                    ) : null;
                  const row = <NotificationRow n={n} unread={!n.read_at} />;
                  return (
                    <div key={n.id} className="border-b border-border last:border-0">
                      {heading}
                      {n.href ? (
                        <Link
                          href={n.href}
                          onClick={() => {
                            void markRead(n.id);
                            setOpen(false);
                          }}
                          className="block hover:bg-surface-muted"
                        >
                          {row}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void markRead(n.id)}
                          className="block w-full hover:bg-surface-muted"
                        >
                          {row}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* The bell shows the latest 30; the page has them all (0746).
                Offered only to those who may open Messages. */}
            {canOpenAll && (
              <Link
                href="/comms/notifications"
                onClick={() => setOpen(false)}
                className="block shrink-0 border-t border-border px-3 py-2.5 text-center text-xs font-semibold text-primary hover:bg-surface-muted"
              >
                View all notifications
              </Link>
            )}
            <div className="shrink-0 border-t border-border p-1">
              <PushToggle />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
