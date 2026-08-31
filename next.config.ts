import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// PWA / offline support. Serwist injects the precache manifest and emits
// public/sw.js at build time (webpack only — see package.json "build" script,
// which uses `--webpack` since Next 16 defaults to Turbopack).
//
// `disable` BELOW STOPS IT BEING GENERATED IN DEV. IT DOES NOT STOP IT BEING
// SERVED, and that distinction cost a debugging session (2026-08-31).
//
// This comment used to read "disabled in development so it never interferes
// with `next dev` / HMR". That is only true of a tree where no production build
// has ever run. `swDest` is **`public/sw.js`**, `next dev` serves `public/`
// statically, and the file is gitignored — so after any `npm run build` the dev
// server happily hands out a PRODUCTION service worker at `/sw.js`, on the same
// `http://localhost:3000` origin. A browser that registers it keeps it
// registered across restarts and intercepts every request the page makes,
// including the Supabase auth POST — which surfaces as a bare
// `TypeError: Failed to fetch` from `signInWithPassword`, with the network,
// the project and the anon key all provably fine.
//
// TWO THINGS FIX IT, AND THE FIRST ALONE IS NOT ENOUGH: delete
// `public/sw.js` + `public/swe-worker-*.js` (both gitignored build output, so
// this is safe and `next build` recreates them), AND unregister the worker in
// the browser — DevTools ▸ Application ▸ Service Workers ▸ Unregister. Removing
// the file cannot unregister an already-installed worker; it only stops the
// next one being handed out.
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

  /**
   * TWO MEMORY SETTINGS, AND THE SECOND ONE IS THE BUG (Vercel build 2026-08-25:
   * `npm run build` exited with SIGKILL after ~3min, "At least one Out of Memory
   * (OOM) event was detected", 4 cores / 8 GB).
   *
   * ## THE BUILD WORKER WAS SILENTLY OFF, AND SERWIST IS WHY
   *
   * Next runs the webpack compilation in a SEPARATE Node worker by default,
   * which is what keeps the module graph and the webpack cache out of the main
   * process heap. "By default" has a condition, and `next/dist/build/index.js`
   * states it exactly:
   *
   *     const useBuildWorker = config.experimental.webpackBuildWorker
   *       || (config.experimental.webpackBuildWorker === undefined && !config.webpack)
   *
   * `withSerwist` injects a `webpack` config to emit the service worker — see
   * the note on `turbopack: {}` below, which is about the same injection. So
   * `config.webpack` is set, the `undefined` branch never fires, and this app
   * has been compiling entirely in the main process. Nothing reports that; the
   * build simply carries the whole graph in one heap until a container with
   * 8 GB kills it.
   *
   * It is `true` EXPLICITLY rather than by deleting Serwist's config, because
   * the SW is the reason `--webpack` is pinned at all. The docs warn the worker
   * "may not be compatible with all custom Webpack plugins", so the check that
   * matters is not that the build passes — it is that `public/sw.js` is still
   * emitted, since a silently missing SW is a PWA that stops updating rather
   * than a build that fails.
   *
   * ## AND THE OFFICIAL LEVER, WHICH IS NOT THE FIX ON ITS OWN
   *
   * `webpackMemoryOptimizations` is Next's own answer to build OOM (v15+,
   * "considered to be low-risk", "may increase compilation times by a slight
   * amount"). Worth having, but it trims a peak rather than moving where the
   * peak lives; the worker above is the structural half.
   *
   * WHAT WAS DELIBERATELY NOT DONE: `typescript.ignoreBuildErrors`. The memory
   * guide offers it and it would very likely make the build pass, by turning off
   * the check that has caught a real error in this repo more than once. A deploy
   * that compiles is not the goal; a deploy that is correct is.
   */
  experimental: {
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
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
