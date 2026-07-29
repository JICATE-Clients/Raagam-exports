import "server-only";

import type { GstinProvider } from "./types";

// ============================================================================
// Provider registry for the online GSTIN lookup. DORMANT BY DESIGN.
//
// v1 always returns null, so every caller short-circuits to "not_configured"
// before any I/O and the feature costs nothing. Turning it on is deliberately
// small: write an adapter module that maps the vendor's payload into
// GstinDetails, add one `case` below, and set the two env vars.
//
// Routes worth knowing about when the time comes:
//   * Commercial API (Sandbox / Masters India / Surepass / AppyFlow / ClearTax)
//     — plain REST + an API key, billed per call, several with free developer
//     tiers. Works from any host. Easiest, and what this shape assumes.
//   * NIC e-Invoice `GetGSTINDetails` — free and official, but requires the
//     company to be registered for e-invoicing AND a static whitelisted IP,
//     which rules out most serverless hosting without a proxy.
//   * A GSP contract with GSTN — the fully official route; contractual.
// Scraping services.gst.gov.in is captcha-walled and against its terms; don't.
// ============================================================================

/**
 * The configured provider, or null when the feature is switched off.
 *
 * Env:
 *   GSTIN_LOOKUP_PROVIDER  — provider key; absent means "off"
 *   GSTIN_LOOKUP_KEY       — that provider's API key
 * The UI is gated separately on NEXT_PUBLIC_GSTIN_LOOKUP so the button never
 * ships to the browser while this is off.
 */
export function getGstinProvider(): GstinProvider | null {
  const name = process.env.GSTIN_LOOKUP_PROVIDER;
  if (!name) return null;

  // switch (name) {
  //   case "sandbox":
  //     return makeSandboxProvider(process.env.GSTIN_LOOKUP_KEY!);
  // }
  return null;
}
