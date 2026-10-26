"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/lib/notifications/use-notifications";
import type { Notification } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

/**
 * The Service Desk alerts that are worth interrupting someone for
 * (service-desk-plan §4 "Pop-up"): a ticket breached its SLA, sat untouched for
 * days, was overridden to Urgent, or arrived in your pool. Everything else stays
 * in the bell, unannounced — a pop-up for every reply would teach people to
 * dismiss them unread.
 */
const POPUP_EVENTS = new Set(["resolve.sd_breach", "resolve.sd_stale", "resolve.sd_urgent", "resolve.sd_new"]);
const MAX_SHOWN = 3;
const TTL_MS = 15000;

type Shown = Notification & { event_key?: string | null };

/**
 * Mounted ONCE in the app shell (`app/(app)/layout.tsx`, beside `PushPrompt`).
 * It reads the same `useNotifications` stream as the bell through its
 * `onInsert` callback, so only rows that ARRIVE while the tab is open pop up —
 * the initial fetch and a refocus refetch never replay old alerts.
 *
 * Not a modal: it never registers with `lib/reload-guard.ts`, never takes
 * focus, and the silent auto-update can reload under it.
 */
export function ResolvePopup() {
  const router = useRouter();
  const [shown, setShown] = useState<Shown[]>([]);
  const onInsert = useCallback((n: Shown) => {
    if (!n.event_key || !POPUP_EVENTS.has(n.event_key)) return;
    setShown((prev) => [n, ...prev.filter((p) => p.id !== n.id)].slice(0, MAX_SHOWN));
  }, []);
  const { markRead } = useNotifications({ onInsert });
  const dismiss = useCallback((id: string) => setShown((prev) => prev.filter((p) => p.id !== id)), []);

  if (shown.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[190] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {shown.map((n) => (
        <PopupCard
          key={n.id}
          n={n}
          onDismiss={dismiss}
          onOpen={() => {
            void markRead(n.id);
            dismiss(n.id);
            if (n.href) router.push(n.href);
          }}
        />
      ))}
    </div>
  );
}

function PopupCard({ n, onDismiss, onOpen }: { n: Shown; onDismiss: (id: string) => void; onOpen: () => void }) {
  const [paused, setPaused] = useState(false);
  const { id } = n;
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => onDismiss(id), TTL_MS);
    return () => clearTimeout(t);
  }, [paused, id, onDismiss]);

  const alarm = n.type === "danger" || n.type === "warning";
  return (
    <div
      role="alert"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn(
        "pointer-events-auto rounded-md border bg-surface p-3 shadow-lg",
        n.type === "danger" ? "border-danger" : n.type === "warning" ? "border-warning" : "border-info",
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-0.5 shrink-0", n.type === "danger" ? "text-danger" : alarm ? "text-warning" : "text-info")}>
          {alarm ? <AlertTriangle className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{n.title}</p>
          {n.body && <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{n.body}</p>}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(id)}
          aria-label="Dismiss"
          className="-mr-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {n.href && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={onOpen}>
            Open
          </Button>
        </div>
      )}
    </div>
  );
}
