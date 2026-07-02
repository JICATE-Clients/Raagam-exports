import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline — Raagam ERP" };

// Static fallback shown when a navigation happens with no network (precached by
// the service worker). Must not fetch data or require auth.
export default function OfflinePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-lg">
        R
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold text-foreground">You&apos;re offline</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          Raagam ERP needs a connection for live data. Reconnect and try again —
          any pages you&apos;ve already opened stay available.
        </p>
      </div>
      <a
        href="/"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm active:scale-95"
      >
        Try again
      </a>
    </div>
  );
}
