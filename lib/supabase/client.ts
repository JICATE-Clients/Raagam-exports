import { createBrowserClient } from "@supabase/ssr";

/**
 * AUTH'S OWN LOG IS WHAT THE OVERLAY SHOWS (2026-10-14, "Failed to fetch" again).
 * When a token refresh cannot reach Supabase (Wi-Fi not back after sleep, a
 * campus network dropping the request), `@supabase/auth-js` `_handleRequest`
 * calls `console.error(e)` ITSELF before rethrowing, and the Next dev overlay
 * turns that log into a full-screen "Console TypeError: Failed to fetch" on
 * whatever screen is open. No try/catch of ours can reach a log the library
 * writes — `use-notifications.ts` already catches the rejection and says so.
 *
 * So the failure is turned into a response before the library sees it: an
 * auth request that never reached the server comes back as a 503, which
 * `handleError` treats as `AuthRetryableFetchError` (retry later, session kept)
 * WITHOUT logging. Auth requests only — a data query that fails still throws
 * exactly as it did, so no caller's error handling changes.
 */
const AUTH_PATH = "/auth/v1/";

const quietAuthFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (err) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.includes(AUTH_PATH)) throw err;
    return new Response(
      JSON.stringify({ message: "Network unreachable", error: "network_unreachable" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
};

/**
 * Browser-side Supabase client (Client Components only).
 * Uses the public anon key; all access is governed by RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: quietAuthFetch } },
  );
}
