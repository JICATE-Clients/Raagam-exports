import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// PWA / offline support. Serwist injects the precache manifest and emits
// public/sw.js at build time (webpack only — see package.json "build" script,
// which uses `--webpack` since Next 16 defaults to Turbopack). The SW is
// disabled in development so it never interferes with `next dev` / HMR.
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  // DELIBERATELY OFF — do not turn this back on. Serwist's implementation is an
  // unconditional `location.reload()` on every `online` event, with no check for
  // what's on screen. On mobile data that fires on any connectivity blip (far
  // more often than we deploy), and it would wipe a half-typed GRN or vendor
  // form. components/pwa/silent-updater.tsx already reloads on reconnect — but
  // only once isSafeToReload() says nothing is open or dirty.
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries: [{ url: "/offline", revision: null }],
});

const nextConfig: NextConfig = {
  // Where the build output goes. Overridable so a VERIFICATION build can be sent
  // somewhere the running dev server isn't reading from.
  //
  // `next dev` and `next build` both default to `.next`, and running a build
  // while dev is up silently corrupts the dev server's view of the app — it
  // keeps serving, but from half-overwritten artifacts, so the browser shows
  // stale code that no longer matches any file on disk. That cost a full
  // debugging round trip on 2026-07-27: a fixed component kept rendering its old
  // output and looked like an unfixed bug.
  //
  // It is worse here than in a stock Next app because the two commands use
  // DIFFERENT BUNDLERS — `dev` runs on Turbopack (see `turbopack: {}` below),
  // while `build` is pinned to `--webpack` for Serwist. So the collision mixes
  // webpack production output into a Turbopack dev directory.
  //
  // `npm run build` is untouched and still writes `.next`. Use
  // `npm run build:check` (scripts/build-check.mjs) to type/compile-check while
  // someone is using the app.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // NOTE: cacheComponents (PPR) is intentionally OFF for now. The Raagam ERP is
  // almost entirely per-user, per-role dynamic data behind auth, so the strict
  // Suspense discipline PPR requires adds friction without payoff at this stage.
  // Revisit for read-heavy public/reporting surfaces later. (see ASSUMPTIONS.md)

  // `withSerwist` injects a `webpack` config (to emit the SW). Since Next 16 runs
  // `next dev` on Turbopack by default, that inherited webpack config otherwise
  // triggers a hard error ("webpack config and no turbopack config"). The SW is
  // disabled in dev, so Turbopack is exactly what we want — this empty object
  // declares that intent and silences the error. The prod `next build --webpack`
  // path (which Serwist needs) is unaffected.
  turbopack: {},

  images: {
    remotePatterns: [
      // Supabase Storage (style images, attachments)
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },

  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
