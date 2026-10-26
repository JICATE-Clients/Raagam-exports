"use client";

import { cn } from "@/lib/utils";
import { useLiveRefresh, type LiveFilter, type LiveStatus } from "./use-live-refresh";

const WORD: Record<LiveStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

/**
 * "Live" with a green dot while the Realtime channel is subscribed,
 * "Reconnecting…" (amber) while it is not. Pass the `status` that
 * `useLiveRefresh` returned — the badge never opens a channel of its own.
 */
export function LiveBadge({ status, className }: { status: LiveStatus; className?: string }) {
  const live = status === "live";
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        live ? "text-success" : "text-muted-foreground",
        className,
      )}
      title={live ? "This screen updates by itself when a ticket changes" : "Waiting for the live connection"}
    >
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 rounded-full",
          live ? "bg-success" : status === "reconnecting" ? "animate-pulse bg-warning" : "bg-muted-foreground/50",
        )}
      />
      {WORD[status]}
    </span>
  );
}

/**
 * The hook and the badge in one, for a SERVER page that has no client
 * component of its own to mount the hook in: `<LiveRefresh filter={…} />`.
 */
export function LiveRefresh({ filter, className }: { filter: LiveFilter | null; className?: string }) {
  const status = useLiveRefresh(filter);
  return <LiveBadge status={status} className={className} />;
}
