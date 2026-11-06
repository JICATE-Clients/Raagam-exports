"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { PushToggle } from "@/components/pwa/push-toggle";
import { NotificationRow } from "@/components/notifications/notification-row";
import { notificationDay } from "@/lib/notifications/look";
import { cn } from "@/lib/utils";

/** `onDark`: the trigger sits on the phone home's blue band (2026-11-04), so it is white. */
export function NotificationsBell({ onDark = false }: { onDark?: boolean } = {}) {
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  // Module grain on purpose: the bell sits on every screen, and the screen in
  // view belongs to some other module, so a screen-aware check would ask the
  // wrong question.
  const canOpenAll = hasPermission(useAppUser(), "communication", "view");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-[15px] font-semibold text-heading">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[28rem] overflow-y-auto">
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
                className="block border-t border-border px-3 py-2 text-center text-xs font-semibold text-primary hover:bg-surface-muted"
              >
                View all notifications
              </Link>
            )}
            <div className="border-t border-border p-1">
              <PushToggle />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
