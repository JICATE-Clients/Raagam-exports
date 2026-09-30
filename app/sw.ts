import { defaultCache } from "@serwist/next/worker";
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

// The build-time precache manifest is injected by @serwist/next.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Do NOT remove skipWaiting: components/pwa/silent-updater.tsx detects a new
  // build via `controllerchange`, which only fires because the new worker
  // activates itself instead of parking in `waiting`. Drop this and updates
  // stop applying silently — there is no UI anywhere that would reveal it.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // defaultCache handles Next static assets, images and fonts. We intentionally
  // do NOT add caching for authenticated Supabase /rest or /auth responses —
  // caching per-user data in a shared service-worker cache is a privacy risk on
  // shared devices.
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        // Serve the offline page for navigations when the network is unavailable.
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// ── Web push ────────────────────────────────────────────────────────────────
// Payload shape is set by lib/notifications/notify.ts: { title, body, url }.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; url?: string } = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Raagam ERP", {
      body: payload.body ?? "",
      icon: "/icons/icon-192x192.png",
      badge: "/icons/badge-72x72.png",
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        // Focus an existing tab and navigate it to the target.
        await client.focus();
        try {
          await client.navigate(url);
        } catch {
          // cross-origin or navigation blocked — ignore
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// ── A subscription the browser replaced on its own ──────────────────────────
// Browsers rotate or expire push subscriptions without asking. Unhandled, the
// server keeps the dead endpoint, the next send 404s/410s, notify() prunes it —
// and that device goes silent until someone happens to open the bell and turn
// alerts back on (notification audit 2026-09-30). So re-subscribe with the same
// key and hand the new one to the server, which swaps it for the old row. The
// request carries the session cookie (same origin); a device with no signed-in
// session is simply picked up by the app's re-sync on the next sign-in.
type SubscriptionChangeEvent = ExtendableEvent & {
  oldSubscription?: PushSubscription | null;
  newSubscription?: PushSubscription | null;
};
self.addEventListener("pushsubscriptionchange", (event) => {
  const e = event as SubscriptionChangeEvent;
  e.waitUntil(
    (async () => {
      const old = e.oldSubscription ?? null;
      const key = old?.options?.applicationServerKey ?? null;
      const sub =
        e.newSubscription ??
        (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!sub) return;
      await fetch("/api/push/resubscribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldEndpoint: old?.endpoint ?? null, subscription: sub.toJSON() }),
      }).catch(() => {});
    })(),
  );
});
