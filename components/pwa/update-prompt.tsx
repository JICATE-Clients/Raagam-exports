"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Shows a "new version available" banner when the service worker detects an
 * update. The SW uses skipWaiting + clientsClaim, so a reload picks up the new
 * assets immediately.
 */
export function UpdatePrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;

    navigator.serviceWorker.ready.then((registration) => {
      const onUpdateFound = () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller &&
            !cancelled
          ) {
            setShow(true);
          }
        });
      };
      registration.addEventListener("updatefound", onUpdateFound);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="fixed left-1/2 top-3 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-2xl">
      <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-[13px] font-medium text-foreground">A new version is available</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground active:scale-95"
      >
        Reload
      </button>
    </div>
  );
}
