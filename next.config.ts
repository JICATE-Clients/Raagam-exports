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
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries: [{ url: "/offline", revision: null }],
});

const nextConfig: NextConfig = {
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
