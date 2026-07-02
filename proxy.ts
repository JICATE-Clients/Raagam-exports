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
    pathname.startsWith("/login") || pathname.startsWith("/register");
  const isAuthCallback = pathname.startsWith("/auth");

  // Unauthenticated → push to login (preserve intended destination)
  if (!user && !isAuthPage && !isAuthCallback) {
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
