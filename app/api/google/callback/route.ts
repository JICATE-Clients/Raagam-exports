import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppUser } from "@/lib/auth/server";
import { completeGoogleConnection } from "@/lib/google/calendar";
import { safeNext, withGoogle } from "@/lib/google/return-path";

/**
 * Google sends the browser back here after the consent screen. The code is
 * swapped for tokens server-side and stored against THIS login only, then the
 * person is returned to the page they started from.
 * This address must match GOOGLE_REDIRECT_URI and the "Authorised redirect
 * URIs" list in Google Cloud exactly.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await getAppUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value;
  const next = safeNext(jar.get("g_oauth_next")?.value);
  jar.delete({ name: "g_oauth_state", path: "/api/google" });
  jar.delete({ name: "g_oauth_next", path: "/api/google" });
  const back = (status: string, detail?: string) => NextResponse.redirect(withGoogle(new URL(next, req.url), status, detail));

  if (url.searchParams.get("error")) return back("denied", url.searchParams.get("error") ?? undefined);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !expected || state !== expected) return back("failed", "The sign-in link expired — try again");

  try {
    await completeGoogleConnection(user.id, code);
  } catch (e) {
    return back("failed", (e as Error).message);
  }
  return back("connected");
}
