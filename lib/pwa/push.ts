"use client";

import { subscribeToPush } from "@/lib/notifications/actions";

/**
 * THIS DEVICE AND WEB PUSH — the one client module every push control uses
 * (the "Turn on alerts" card, the bell's toggle, the silent re-sync on load).
 *
 * The notification audit (2026-09-30) found `push_subscriptions` EMPTY: the
 * only way in was a small link at the foot of the bell menu, nothing ever
 * asked, and a failed save still showed "enabled". The pieces here are what
 * those three controls had each half-done.
 */

export type PushSupport = "supported" | "no-key" | "ios-needs-install" | "unsupported";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** An iPhone/iPad browser tab: push exists only once the app is on the home screen. */
function isIosBrowserTab(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const ios = /ipad|iphone|ipod/.test(ua) || (ua.includes("macintosh") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return "no-key";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "supported";
  return isIosBrowserTab() ? "ios-needs-install" : "unsupported";
}

export function isStandalone(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true)
  );
}

async function save(sub: PushSubscription): Promise<{ ok: true } | { ok: false; error: string }> {
  const json = sub.toJSON();
  if (!json.keys?.p256dh || !json.keys.auth) return { ok: false, error: "The browser returned an incomplete subscription." };
  return subscribeToPush({
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent,
  });
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as BufferSource,
  });
}

/**
 * Ask (if needed), subscribe and SAVE. The answer says what happened, so a
 * control never shows "on" for a device the server does not know about.
 */
export async function turnOnPush(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (pushSupport() !== "supported") return { ok: false, error: "This browser cannot receive alerts." };
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        error:
          permission === "denied"
            ? "Alerts are blocked for this site. Allow notifications in the browser's site settings, then try again."
            : "Alerts were not allowed.",
      };
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await subscribe(reg));
    return await save(sub);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not turn on alerts." };
  }
}

export async function turnOffPush(): Promise<void> {
  const { unsubscribeFromPush } = await import("@/lib/notifications/actions");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await unsubscribeFromPush(sub.endpoint);
    await sub.unsubscribe();
  }
  forgetPushSync();
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * ON EVERY SIGNED-IN LOAD, quietly: where the person has already allowed
 * alerts, make sure THIS login holds a live subscription for this device.
 * Covers the three ways one goes missing without anyone noticing — the browser
 * rotated or expired it, the server pruned it after a 404/410, or a different
 * login is now using the device (the row is keyed by user + endpoint). Never
 * asks: without permission already granted it does nothing.
 */
export async function resyncPush(userId: string): Promise<void> {
  try {
    if (pushSupport() !== "supported" || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await subscribe(reg));
    /* ONE SAVE PER CHANGE, NOT PER PAGE LOAD. Server actions are queued in
       this app (memory: load time = round trips), so an upsert on every load
       would sit in front of the screen's own actions. The pair it last saved
       is remembered on the device; the server row is re-sent only when the
       endpoint or the login changed. */
    const stamp = `${userId}|${sub.endpoint}`;
    let last: string | null = null;
    try {
      last = localStorage.getItem(SYNC_KEY);
    } catch {
      /* private mode: just save */
    }
    if (last === stamp) return;
    const res = await save(sub);
    if (res.ok) {
      try {
        localStorage.setItem(SYNC_KEY, stamp);
      } catch {
        /* nothing to remember with */
      }
    }
  } catch {
    // best-effort; the bell's toggle is the visible way to fix it
  }
}

const SYNC_KEY = "raagam.push.synced";

/** Forget the device's "already saved" mark (after turning alerts off). */
export function forgetPushSync(): void {
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch {
    /* nothing stored */
  }
}
