"use client";

import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isStandalone, pushSupport, resyncPush, turnOnPush } from "@/lib/pwa/push";

/**
 * "TURN ON ALERTS" — asked once, after sign-in (notification audit 2026-09-30).
 *
 * `push_subscriptions` held ZERO rows: the only way to allow alerts was a small
 * link at the foot of the bell menu and nothing ever asked, so no phone had
 * ever received one. This card asks, on the device the person is using, and
 * says what went wrong when it fails instead of showing "on".
 *
 * WHEN IT SHOWS — only where saying yes can actually work, and never on top of
 * the install prompt (components/pwa/install-prompt.tsx, bottom-left):
 *   - the browser supports push and the site has not been answered yet
 *     (`Notification.permission === "default"`);
 *   - on a phone, only inside the INSTALLED app — a phone browser tab gets the
 *     install prompt first, and an iPhone tab cannot receive push at all until
 *     the app is on the home screen (that prompt says how);
 *   - not dismissed on this device in the last 14 days.
 *
 * It also runs the silent re-sync (`resyncPush`) on every signed-in load, so a
 * device that already said yes keeps a live subscription for THIS login.
 *
 * Not a modal: a small card that leaves the screen usable, so it neither traps
 * focus nor registers with the reload guard.
 */

const DISMISS_KEY = "raagam.pushPrompt.dismissedAt";
const REASK_MS = 14 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && Date.now() - at < REASK_MS;
  } catch {
    return false;
  }
}

export function PushPrompt({ userId }: { userId: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void resyncPush(userId);
    if (pushSupport() !== "supported") return;
    if (Notification.permission !== "default") return;
    const phone = window.matchMedia("(max-width: 767px)").matches;
    if (phone && !isStandalone()) return;
    if (dismissedRecently()) return;
    // A beat after the page settles, so it does not land on top of the first paint.
    const t = window.setTimeout(() => setShow(true), 1500);
    return () => window.clearTimeout(t);
  }, [userId]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: it will ask again next time */
    }
    setShow(false);
  }

  async function allow() {
    setBusy(true);
    setError(null);
    const res = await turnOnPush();
    setBusy(false);
    if (res.ok) setShow(false);
    else setError(res.error);
  }

  if (!show) return null;

  return (
    <div
      role="region"
      aria-label="Turn on alerts"
      className="fixed inset-x-3 bottom-24 z-30 mx-auto max-w-sm rounded-2xl border border-border bg-surface p-4 shadow-2xl md:bottom-4 md:left-auto md:right-4 md:mx-0"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BellRing className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Turn on alerts on this device</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Get approvals, CAD requests and overdue work on your screen, even when the app is closed.
          </p>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={allow} disabled={busy}>
              {busy ? "Turning on…" : "Turn on"}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
