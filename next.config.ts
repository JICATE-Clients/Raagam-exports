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

/**
 * VERSION SKEW: THE "THE CSS DISAPPEARED" REPORT, AND WHY THE FIX IS NOT HERE
 * (reported 2026-09-03, on Fabric BOM ▸ Components).
 *
 * ## THE FAILURE
 *
 * A deploy replaces every hashed asset. A tab that was already open is still
 * running the OLD document, which links `/_next/static/css/<old hash>.css` —
 * a file the new deployment does not serve. The stylesheet 404s and the page
 * renders unstyled. The markup is fine; only the CSS is gone.
 *
 * `app/sw.ts` makes it likelier rather than causing it: `clientsClaim: true`
 * hands the open tab to the new worker immediately, so it is reading the new
 * precache while still running the old bundle — the exact state the comment
 * beside `skipWaiting` in that file describes.
 *
 * ## WHY IT LOOKS LIKE "ONLY SOME USERS"
 *
 * `components/pwa/silent-updater.tsx` repairs this by reloading, and it is
 * gated on `isSafeToReload()` (lib/reload-guard.ts) — false while a form is
 * dirty, an overlay is open, or the operator typed in the last few seconds. So
 * the users who see it are precisely the ones with unsaved work in an editor
 * when a deploy lands, which is why an editor tab like Components collects the
 * reports. It DOES recover: `attempt()` re-runs on the busy subscription, on
 * visibility change, on `online`, and every 30s. The cost is that the page
 * looks broken until the operator saves or closes.
 *
 * ## THE FIX IS VERCEL SKEW PROTECTION, A PROJECT SETTING
 *
 * Turn it on in the Vercel project (Settings ▸ Deployment Protection ▸ Skew
 * Protection). Vercel then routes a request carrying an old deployment id back
 * to the deployment that served it, so the old tab keeps fetching its own CSS
 * and never breaks. Nothing has to change in this file: Vercel sets
 * `NEXT_DEPLOYMENT_ID`, and `next/dist/server/config.js` adopts it
 * automatically when `hasNextSupport` is true (i.e. on Vercel).
 *
 * ## DO NOT SET `deploymentId` HERE INSTEAD. IT IS THE WRONG LEVER, TWICE.
 *
 * It does not keep old assets alive — it stamps `?dpl=` on asset URLs and adds
 * a deployment-id header, and on a mismatch Next answers with a HARD
 * NAVIGATION. Next's own note on it: "there may be a loss of application
 * state". That is a forced reload over half-typed work, which is the single
 * thing `lib/reload-guard.ts` and AGENTS.md's auto-reload rule exist to
 * prevent — it would trade an ugly screen for lost data.
 *
 * And once Skew Protection is on, a hand-written value here is a BUILD ERROR:
 * `config.js` throws when `deploymentId` disagrees with `NEXT_DEPLOYMENT_ID`.
 */
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
   * ## AND A HEAP CAP, BECAUSE THE APP OUTGREW THE FIRST TWO (2026-09-19)
   *
   * The same OOM came back after PR #164 (+9k lines): the build WORKER itself
   * was SIGKILLed ~85s into compiling, both settings above still on. A
   * SIGKILL is the CONTAINER killing the process, not V8 running out of heap
   * ("JavaScript heap out of memory" never printed): V8 sized its heap from
   * the host, grew freely, and RSS crossed 8 GB before it chose to collect.
   *
   * So `npm run build` passes `--max-old-space-size=3072` on the command line
   * (package.json). On the command line, not `NODE_OPTIONS=… next build`:
   * that syntax does not run in Windows' cmd, and it needs no Vercel setting.
   * It still reaches the worker, because `next/dist/lib/worker.js` reads
   * `process.execArgv` (`getParsedNodeOptions`) and the webpack worker is not
   * `isolatedMemory`, so the flag is forwarded into its NODE_OPTIONS.
   *
   * MEASURED, not guessed: under the 3 GB cap the local build passed and the
   * build's own processes peaked at 5.5 GB RSS (5.4 GB in the worker: 3 GB of
   * heap plus ~2.4 GB native — SWC and buffers, which the cap does not bound).
   * That leaves ~2.5 GB of the 8 GB box for npm, the Vercel CLI and the OS.
   * Lower the cap and the worker dies with a HEAP error instead; raise it and
   * the headroom goes. If it recurs, re-measure before moving the number —
   * the next lever is Vercel's Enhanced Builds (16 GB), a paid setting.
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

  /**
   * THE THIRD OOM, AND THE ONE LEVER THE TWO ABOVE NEVER PULLED
   * (Vercel build 2026-09-22, commit 539da4a: SIGKILL, "At least one Out of
   * Memory (OOM) event was detected", 4 cores / 8 GB).
   *
   * ## IT FAILED SLOWLY, WHICH IS A DIFFERENT SYMPTOM
   *
   * The 08-25 OOM died in ~3 minutes and the 09-19 one in ~85 seconds. This one
   * ground for FORTY-THREE MINUTES (16:34:16 compile start → 17:17:36 SIGKILL)
   * without printing a single compile line. That is not the build getting
   * bigger; it is the `--max-old-space-size=3072` cap above doing its job too
   * well. Measured locally on this tree, the worker reaches the ceiling within
   * two minutes of compiling and then oscillates against it — 2.99 → 3.09 →
   * 2.92 GB — so V8 spends its time in mark-compact instead of in webpack. RSS
   * kept climbing past 3.96 GB on native memory the cap does not bound, and on
   * an 8 GB box that plus the main process is what the kernel kills.
   *
   * A build that gets SLOWER before it dies is a heap ceiling, not growth
   * alone. Growth is why the ceiling was reached: master gained 300 files and
   * +28,296 lines across app/ components/ lib/ in the three days after the cap
   * was measured, so the ~2.5 GB of headroom that commit left is spent.
   *
   * ## THE CACHE, WHICH NEXT'S OWN MEMORY GUIDE NAMES AND THIS FILE SKIPPED
   *
   * `webpackBuildWorker` and `webpackMemoryOptimizations` were both already on.
   * The third item in `docs/01-app/02-guides/memory-usage.md` — "Disable
   * Webpack cache" — was not, and it is the one that matches the evidence:
   * webpack's filesystem cache "saves generated Webpack modules in memory
   * and/or to disk … it will also increase the memory usage". Vercel restores
   * it (`Restored build cache from previous deployment` is line 4 of that
   * build's log), so the worker deserialises a previous deployment's module
   * graph into the very heap that is already at its ceiling. Swapping it for a
   * memory cache means nothing is read in at the start or written out at the
   * end.
   *
   * IT COSTS COLD BUILDS. Every deploy now recompiles from scratch, so wall
   * time goes UP on a build that would have had a warm cache — which is the
   * trade being made deliberately: a slower green build beats a 43-minute red
   * one. `next build` is the only thing affected (`dev` is Turbopack and never
   * reaches here); the guard is on `!dev` regardless, because HMR without a
   * cache is not a trade anyone wants.
   *
   * ## THIS FUNCTION IS ALSO WHY `webpackBuildWorker` MUST STAY EXPLICIT
   *
   * Serwist already set `config.webpack`, which is what silently disabled the
   * build worker before 08-25 — see the note on `experimental` above. Declaring
   * one here changes nothing about that (it was already set), but it removes
   * the last reason anyone might think deleting Serwist's injection would
   * restore the default. It cannot; the default is gone either way.
   *
   * Serwist composes rather than overwrites — `@serwist/next`'s `index.mjs`
   * calls `nextConfig.webpack(config, options)` first and then adds its own
   * plugin — so the service worker is unaffected. The check that matters after
   * touching this file is not that the build passes, it is that `public/sw.js`
   * is still emitted: a silently missing SW is a PWA that stops updating.
   *
   * IF IT RECURS, the remaining levers are Vercel's Enhanced Builds (16 GB, a
   * paid setting) and dropping the `--webpack` pin entirely — serwist 9.5.11
   * now names two Turbopack routes of its own (`@serwist/turbopack`, and
   * "configurator mode"), and a Rust bundler does not have a Node heap to run
   * out of. Do NOT raise the cap: 4 GB of heap plus ~2.4 GB of native plus the
   * main process is ~8.9 GB on an 8 GB box, so it would die sooner.
   */
  webpack: (config, { dev }) => {
    if (config.cache && !dev) {
      config.cache = Object.freeze({ type: "memory" });
    }
    return config;
  },

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
