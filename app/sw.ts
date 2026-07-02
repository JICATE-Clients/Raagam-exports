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
