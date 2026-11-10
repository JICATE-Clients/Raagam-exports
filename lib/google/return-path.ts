/** Where "Connect Google Calendar" returns the person to afterwards. */

/** Only a path inside this app — never `//evil.com` or a full URL. */
export function safeNext(v: string | null | undefined): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/hr/events";
}

/** Adds `?google=<status>` (and an optional reason) for the page to read. */
export function withGoogle(u: URL, status: string, detail?: string): URL {
  u.searchParams.set("google", status);
  if (detail) u.searchParams.set("detail", detail.slice(0, 200));
  return u;
}
