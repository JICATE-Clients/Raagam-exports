"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { StatusDot, type StatusTone } from "@/components/ui/status-pill";
import { PushToggle } from "@/components/pwa/push-toggle";
import type { Notification, NotificationType } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

const TONE: Record<NotificationType, StatusTone> = {
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

export function NotificationsBell() {
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  function row(n: Notification) {
    return (
      <div className={cn("flex gap-2.5 px-3 py-2.5 text-left", !n.read_at && "bg-primary/5")}>
        <span className="mt-1 shrink-0">
          <StatusDot tone={TONE[n.type] ?? "info"} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{n.title}</p>
          {n.body && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
          </p>
        </div>
        {!n.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-md border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No notifications yet.
                </p>
              ) : (
                items.map((n) =>
                  n.href ? (
                    <Link
                      key={n.id}
                      href={n.href}
                      onClick={() => {
                        void markRead(n.id);
                        setOpen(false);
                      }}
                      className="block border-b border-border last:border-0 hover:bg-surface-muted"
                    >
                      {row(n)}
                    </Link>
                  ) : (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => void markRead(n.id)}
                      className="block w-full border-b border-border last:border-0 hover:bg-surface-muted"
                    >
                      {row(n)}
                    </button>
                  ),
                )
              )}
            </div>

            <div className="border-t border-border p-1">
              <PushToggle />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
