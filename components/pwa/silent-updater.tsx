"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isSafeToReload, markKeyActivity, subscribeBusy } from "@/lib/reload-guard";

/**
 * Applies a new build automatically, with no UI at all — no banner, no toast,
 * no button. Replaces the old "A new version is available / [Reload]" prompt.
 *
 * How an update actually reaches the user:
 *   `app/sw.ts` sets skipWaiting + clientsClaim, so a new service worker
 *   installs, activates and claims this tab on its own. The page is then
 *   running an OLD JS bundle against a NEW cache until something reloads it.
 *   That reload is all this component does.
 *
 * IMPORTANT: detection keys off `controllerchange`, which only fires because of
 * `skipWaiting: true` in `app/sw.ts`. Drop that flag and the new worker parks in
 * `waiting` forever, `controllerchange` never fires, and updates silently stop
 * applying — with no UI anywhere to reveal it. See the note in `app/sw.ts`.
 *
 * The reload is gated on `isSafeToReload()` (lib/reload-guard.ts): if the user
 * has an editor open or unsaved changes, the update stays pending and lands at
 * the next safe moment instead.
 */

/** Per-tab ledger, so a reload can't wipe the evidence of the last reload. */
const RELOAD_AT_KEY = "raagam:sw-reloaded-at";
const RELOAD_COUNT_KEY = "raagam:sw-reload-count";

const MIN_RELOAD_GAP_MS = 60_000;
const MAX_RELOADS_PER_BURST = 3;
/** Reloads spread wider than this are normal deploys, not a loop — count resets. */
const BURST_WINDOW_MS = 10 * 60 * 1000;
/** Never auto-reload a page that only just loaded — makes a tight loop impossible. */
const MIN_UPTIME_MS = 10_000;
/** How often to ask the browser to re-fetch sw.js. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** Floor between update checks, so alt-tab flapping can't spam the network. */
const MIN_UPDATE_CHECK_GAP_MS = 5 * 60 * 1000;
/** Catch-all re-check for overlays that have no close event to subscribe to. */
const RETRY_MS = 30_000;

/**
 * Claim the right to reload, or refuse. Two independent limits: at most one
 * auto-reload per minute, and at most three within a 10-minute burst — so a
 * pathological deploy degrades to "reloaded three times, then stopped" instead
 * of an inescapable loop with no UI to cancel it.
 *
 * The cap is a rolling burst, not a session total, on purpose. A tab left open
 * for a week legitimately sees more than three deploys; a per-session cap would
 * silently stop updating it forever. A real loop reloads in rapid succession,
 * which the window still catches.
 *
 * sessionStorage, not localStorage: it's per-tab (one tab reloading shouldn't
 * starve another of the same update) and it dies with the tab, so a stale
 * ledger can never wedge an install permanently. Not a ref, because the reload
 * wipes memory — memory is exactly what we can't trust here.
 */
function claimReloadSlot(): boolean {
  try {
    const ss = window.sessionStorage;
    const now = Date.now();
    const last = Number(ss.getItem(RELOAD_AT_KEY) ?? 0);
    const stored = Number(ss.getItem(RELOAD_COUNT_KEY) ?? 0);
    const valid = Number.isFinite(last) && last > 0;
    // Outside the burst window the previous reloads are ancient history.
    const count = valid && now - last < BURST_WINDOW_MS ? stored : 0;
    if (count >= MAX_RELOADS_PER_BURST) return false;
    if (valid && now - last < MIN_RELOAD_GAP_MS) return false;
    ss.setItem(RELOAD_AT_KEY, String(now));
    ss.setItem(RELOAD_COUNT_KEY, String(count + 1));
    return true;
  } catch {
    // Storage blocked → we'd have zero loop protection. Fail closed: skip the
    // auto-reload entirely; the user still gets the new build on their next
    // real navigation.
    return false;
  }
}

export function SilentUpdater(): null {
  const pathname = usePathname();
  // The pathname effect needs the live `attempt` closure from the mount effect.
  const attemptRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const sw = navigator.serviceWorker;
    let disposed = false;
    let pending = false;
    let lastCheckAt = 0;
    let registration: ServiceWorkerRegistration | null = null;

    // Captured synchronously: if there was no controller at mount, the first
    // controllerchange is this origin's FIRST service worker install, not an
    // update — the page already is the new build, so reloading it is noise.
    let hadController = !!sw.controller;

    const attempt = () => {
      if (disposed || !pending) return;
      if (performance.now() < MIN_UPTIME_MS) return;
      if (!isSafeToReload()) return;
      if (!claimReloadSlot()) return;
      pending = false;
      window.location.reload();
    };
    attemptRef.current = attempt;

    /** Ask the browser to re-fetch sw.js, throttled. */
    const maybeCheck = () => {
      if (disposed || !registration) return;
      const now = Date.now();
      if (now - lastCheckAt < MIN_UPDATE_CHECK_GAP_MS) return;
      lastCheckAt = now;
      registration.update().catch(() => {
        /* offline or transient — the next trigger will retry */
      });
    };

    const onControllerChange = () => {
      if (disposed) return;
      if (!hadController) {
        hadController = true;
        return;
      }
      pending = true;
      attempt();
    };

    const onVisibility = () => {
      // Fires on hide as well as show. Reloading a backgrounded tab is the
      // ideal outcome — the user never sees it happen. It still goes through
      // isSafeToReload(), so a hidden tab with a dirty editor stays put.
      maybeCheck();
      attempt();
    };

    const onOnline = () => {
      maybeCheck();
      attempt();
    };

    // Passive + capture, and it only writes a timestamp: it can never interfere
    // with the Enter/Tab protocols in keyboard-nav-provider.tsx or sheet.tsx.
    const onKeyDown = () => markKeyActivity();

    sw.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("keydown", onKeyDown, { passive: true, capture: true });

    const unsubscribeBusy = subscribeBusy(attempt);
    const retryTimer = window.setInterval(attempt, RETRY_MS);
    const checkTimer = window.setInterval(maybeCheck, UPDATE_CHECK_MS);

    sw.ready
      .then((reg) => {
        if (disposed) return;
        registration = reg;
        // Registration has just checked sw.js; seed the throttle so the hourly
        // timer doesn't fire a redundant check moments later.
        lastCheckAt = Date.now();
      })
      .catch(() => {
        /* no SW in this environment (dev, or unsupported) — nothing to do */
      });

    return () => {
      disposed = true;
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      unsubscribeBusy();
      window.clearInterval(retryTimer);
      window.clearInterval(checkTimer);
    };
  }, []);

  // A route change means the previous screen is done with — a good moment to
  // land a deferred update.
  useEffect(() => {
    attemptRef.current();
  }, [pathname]);

  return null;
}
