import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session and returns both the response (carrying
 * refreshed cookies) and the current user. Consumed by the root `proxy.ts`.
 *
 * Next.js 16: middleware is renamed to `proxy` and runs on the Node.js runtime.
 */
export async function updateSession(request: NextRequest) {
  /**
   * THE PAGE THIS REQUEST IS ON, FOR THE SCREEN-LEVEL PERMISSION CHECKS (0658).
   *
   * `can()` / `requirePermission()` read `x-pathname` to know which SCREEN a
   * page load — or a server action, which POSTs to its page's own URL — is
   * on (lib/auth/server.ts `currentScreen`). It is SET here, never appended,
   * so a value a browser sends is overwritten on every request: nobody can
   * claim to be on a screen they are not. Rebuilt at both `NextResponse.next`
   * sites, because the session refresh below writes cookies onto `request`
   * AFTER the first one — a headers copy taken once would lose them.
   */
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-pathname", request.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
  };
  let response = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = next();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not put logic between createServerClient and this call — it
  // is also what refreshes an expired session and writes the new cookies.
  //
  // getClaims(), NOT getUser() (2026-09-24, "every click takes 3 s"). getUser()
  // is a network round trip to Supabase Auth on EVERY request — every page,
  // every server action — ~260 ms before any app code runs. This project signs
  // with an asymmetric key (ES256, published at /auth/v1/.well-known/jwks.json),
  // so getClaims() verifies the JWT's signature LOCALLY against the cached
  // public key: same guarantee (a forged or expired token is refused), no trip.
  // Should the project ever go back to a symmetric key, getClaims() falls back
  // to asking the Auth server itself, so this stays correct either way.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub } : null;

  return { response, user };
}
