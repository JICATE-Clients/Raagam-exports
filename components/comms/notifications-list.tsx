"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { markAllRead, markNotificationRead } from "@/lib/notifications/actions";
import type { Notification } from "@/lib/notifications/types";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT: Record<Notification["type"], string> = {
  info: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/**
 * The full notification inbox. Opening an alert marks it read and follows its
 * link; the linked screen re-checks access itself (a notification grants
 * nothing). The list re-reads when the tab comes back into view, so alerts that
 * arrived meanwhile are there — the bell already streams them live.
 */
export function NotificationsList({
  items,
  next,
  unreadOnly,
  paged,
}: {
  items: Notification[];
  next: string | null;
  unreadOnly: boolean;
  paged: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [readNow, setReadNow] = useState<Set<string>>(new Set());
  const base = unreadOnly ? "/comms/notifications?filter=unread" : "/comms/notifications";

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  const unread = items.filter((n) => !n.read_at && !readNow.has(n.id)).length;

  function open(n: Notification) {
    if (!n.read_at && !readNow.has(n.id)) {
      setReadNow((s) => new Set(s).add(n.id));
      void markNotificationRead(n.id);
    }
  }

  function readAll() {
    start(async () => {
      const r = await markAllRead();
      if (!r.ok) toast.error(r.error);
      else {
        setReadNow(new Set(items.map((n) => n.id)));
        router.refresh();
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Link
          href="/comms"
          className="rounded-md p-2.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden [@media(hover:hover)]:p-1.5"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">Notifications</h1>
        <ToggleGroup
          label="Show"
          value={unreadOnly ? "unread" : "all"}
          onChange={(v) => router.push(v === "unread" ? "/comms/notifications?filter=unread" : "/comms/notifications")}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread" },
          ]}
        />
        <Button size="sm" variant="outline" onClick={readAll} disabled={pending || unread === 0}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} Mark all read
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {unreadOnly ? "Nothing unread. You are all caught up." : "No notifications yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const isUnread = !n.read_at && !readNow.has(n.id);
              const row = (
                <>
                  <span
                    aria-hidden
                    className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isUnread ? DOT[n.type] : "bg-transparent")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block break-words text-sm text-foreground", isUnread && "font-semibold")}>
                      {n.title}
                    </span>
                    {n.body && <span className="block break-words text-xs text-muted-foreground">{n.body}</span>}
                    <time dateTime={n.created_at} className="block text-[11px] text-muted-foreground">
                      {fmtDateTime(n.created_at)}
                    </time>
                  </span>
                  {isUnread && <span className="sr-only">Unread</span>}
                </>
              );
              const cls =
                "flex gap-3 px-4 py-3 hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none";
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link href={n.href} onClick={() => open(n)} className={cls}>
                      {row}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => open(n)} className={cn(cls, "w-full text-left")}>
                      {row}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-center gap-3 py-3">
          {paged && (
            <Link href={base} className="text-xs font-semibold text-primary hover:underline">
              Back to newest
            </Link>
          )}
          {next && (
            <Link
              href={`${base}${base.includes("?") ? "&" : "?"}before=${encodeURIComponent(next)}`}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Older notifications
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
