import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (Server Components, Server Actions, Route Handlers).
 *
 * Next.js 16: `cookies()` is async and MUST be awaited.
 * The `setAll` try/catch guards the case where this is called from a Server
 * Component render (cookies are read-only there); the proxy refreshes sessions.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore; the proxy
            // (proxy.ts) is responsible for writing refreshed session cookies.
          }
        },
      },
    },
  );
}

/**
 * Privileged server client using the service-role key. Bypasses RLS — use ONLY
 * in trusted server code for admin operations (e.g. provisioning users). Never
 * import this into Client Components.
 */
export function createAdminClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    },
  );
}
