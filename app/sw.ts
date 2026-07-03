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
