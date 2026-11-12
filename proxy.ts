import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16: middleware is renamed to `proxy` (Node.js runtime, no edge).
 * Refreshes the Supabase session and gates routes by auth state.
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isAuthPage =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/forgot-password");
  const isAuthCallback = pathname.startsWith("/auth");

  /**
   * A SCHEDULED JOB CARRIES NO SESSION, AND THIS GATE WOULD SWALLOW IT (0601).
   *
   * Vercel's cron calls the route over plain HTTPS with no cookies. Without
   * this branch the redirect below answers 307 → /login, the cron records a
   * SUCCESS (it got a 2xx/3xx, not an error), and the SLA sweep never runs —
   * a schedule that reports itself green while doing nothing, which is exactly
   * the failure AGENTS.md's "Function grants" section records about migrations
   * that apply cleanly and achieve nothing.
   *
   * These routes are NOT unprotected: each checks `CRON_SECRET` itself and
   * answers 401 without it. Auth moves into the handler; it does not go away.
   */
  //
  // `/api/transport/` is a GPS vendor's webhook (doc/vehicle program/telematics.md)
  // and gets the same treatment: no cookies, and a 307 would be retried forever.
  // Its route checks `x-transport-secret` against TRANSPORT_WEBHOOK_SECRET (503
  // when unset, 401 when wrong).
  const isCronJob = pathname.startsWith("/api/cron/") || pathname.startsWith("/api/transport/");

  /**
   * A BUYER'S APPROVAL LINK (0668) — `/p/approve/<token>` is opened by someone
   * with no login. Not unprotected either: the page and its decide action
   * look the token up by its sha-256, and the decision runs only through a
   * service_role function. The token is the authorisation; this gate is not.
   */
  const isPublicLink = pathname.startsWith("/p/");

  /**
   * A BIOMETRIC DEVICE AT A GATE (0733) — `/iclock/*` is called by an eSSL /
   * ZKTeco device over ADMS push, through the Cloudflare bridge. The device has
   * no login and does not follow redirects: a 307 → /login is simply a request
   * it never completes, and it would keep the punch and retry forever while the
   * ERP showed nobody arriving.
   *
   * Same shape as the cron branch above, and the same reasoning — auth moves
   * INTO the handler rather than going away. The route refuses any request
   * without the shared `x-bridge-key` (only the Worker has it) and any serial
   * number outside `ALLOWED_SN`, and it fails closed when the key is unset.
   */
  const isDevicePush = pathname.startsWith("/iclock/");

  // Unauthenticated → push to login (preserve intended destination)
  if (
    !user &&
    !isAuthPage &&
    !isAuthCallback &&
    !isCronJob &&
    !isPublicLink &&
    !isDevicePush
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    /**
     * A SERVER ACTION WHOSE SESSION HAS ENDED (2026-11-06). A 307 here makes the
     * browser's action fetch follow it to the /login HTML page, and Next's
     * action client — which only accepts `text/x-component` — throws "An
     * unexpected response was received from the server." over whatever the
     * operator clicked (seen when the refresh token was refused: "Invalid
     * Refresh Token: Refresh Token Not Found"). `x-action-redirect` is the
     * header Next's own action redirects use; with an empty body the client
     * does a full navigation to /login, so the operator lands on the sign-in
     * page instead of an error overlay. Nothing is let through: no session
     * still means the action never runs.
     */
    if (request.method === "POST" && request.headers.has("next-action")) {
      return new NextResponse(null, {
        status: 200,
        headers: { "x-action-redirect": `${url.pathname}${url.search};replace`, "content-type": "text/plain" },
      });
    }
    return NextResponse.redirect(url);
  }

  // Authenticated user hitting login/register → send home
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets / images and the public PWA entry points
    // (the web manifest + service worker must be served without an auth redirect,
    // or the browser can't validate the manifest / register the service worker).
    // woff2: the self-hosted fonts (app/fonts.css) — the login page needs them
    // before there is a session.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|swe-worker.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
