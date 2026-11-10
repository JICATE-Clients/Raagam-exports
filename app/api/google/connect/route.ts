import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppUser } from "@/lib/auth/server";
import { googleAuthUrl, googleEnv } from "@/lib/google/calendar";
import { safeNext, withGoogle } from "@/lib/google/return-path";

/**
 * "Connect Google Calendar" — sends the browser to Google's consent screen.
 *
 * Open to ANY signed-in person: the connection is personal (it lets THEIR
 * Google account send invites), and each place that uses it — HR ▸ Events,
 * the chat's 📎 Event — checks its own permission before sending anything.
 *
 * A random `state` rides in an httpOnly cookie and must come back unchanged to
 * /api/google/callback, so a forged callback is refused. `?next=` (a path in
 * this app only) is where the person is returned afterwards.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const user = await getAppUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!googleEnv()) return NextResponse.redirect(withGoogle(new URL(next, req.url), "not-configured"));

  const state = crypto.randomUUID();
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/google",
    maxAge: 600,
  };
  jar.set("g_oauth_state", state, opts);
  jar.set("g_oauth_next", next, opts);
  return NextResponse.redirect(googleAuthUrl(state));
}
