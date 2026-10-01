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
  const isCronJob = pathname.startsWith("/api/cron/");

  /**
   * A BUYER'S APPROVAL LINK (0668) — `/p/approve/<token>` is opened by someone
   * with no login. Not unprotected either: the page and its decide action
   * look the token up by its sha-256, and the decision runs only through a
   * service_role function. The token is the authorisation; this gate is not.
   */
  const isPublicLink = pathname.startsWith("/p/");

  // Unauthenticated → push to login (preserve intended destination)
  if (!user && !isAuthPage && !isAuthCallback && !isCronJob && !isPublicLink) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
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
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|swe-worker.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
