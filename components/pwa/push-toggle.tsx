"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff } from "lucide-react";
import { currentPushSubscription, pushSupport, turnOffPush, turnOnPush, type PushSupport } from "@/lib/pwa/push";

/**
 * Alerts on this device, from the bell menu. Built on lib/pwa/push.ts, which
 * the "Turn on alerts" card shares, so both say the same thing and both check
 * the save: this used to flip to "enabled" whether or not the server stored the
 * subscription (notification audit 2026-09-30).
 *
 * On an iPhone browser tab push does not exist until the app is on the home
 * screen, so instead of rendering nothing it says how. The service worker only
 * runs in a production build, so this is inert under `next dev`.
 */
const noSubscribe = () => () => {};

export function PushToggle() {
  // What this device can do never changes while the page is open, so it is read
  // once as an external value: "unsupported" on the server, the real answer in
  // the browser — no state set from an effect, no hydration mismatch.
  const support = useSyncExternalStore<PushSupport>(noSubscribe, pushSupport, () => "unsupported");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (support !== "supported") return;
    currentPushSubscription().then((sub) => setEnabled(!!sub && Notification.permission === "granted"));
  }, [support]);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await turnOffPush();
        setEnabled(false);
      } else {
        const res = await turnOnPush();
        if (res.ok) setEnabled(true);
        else setError(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  if (support === "ios-needs-install") {
    return (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        To get alerts on iPhone: tap Share ▸ Add to Home Screen, then open Raagam from the home screen.
      </p>
    );
  }
  if (support !== "supported") return null;

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-60"
      >
        {enabled ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
        {enabled ? "Turn off alerts on this device" : "Turn on alerts on this device"}
      </button>
      {error && <p className="px-2 pb-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
