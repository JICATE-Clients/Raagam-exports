import "server-only";
import { headers } from "next/headers";

/**
 * A small fixed-window rate limit for PUBLIC endpoints — today the buyer's
 * approval page and its actions (0672, `/p/approve/<token>`), which answer a
 * caller with no session.
 *
 * WHAT IT IS AND IS NOT. The window lives in this server instance's memory, so
 * on Vercel each instance counts on its own and a cold start resets it. It
 * stops one browser or script hammering a page; it is not a distributed
 * limiter. That is enough here because the real guard is elsewhere: a link
 * token is 256 random bits (nothing to guess) and `ta_link_decide` takes a
 * link's answer once. Put a platform firewall rule in front if a page ever
 * needs more.
 */

type Window = { start: number; count: number };
const windows = new Map<string, Window>();
const MAX_KEYS = 5_000;

/** The caller's address as the platform reports it; "unknown" when absent. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * True while `key` is under `limit` hits in the current `windowMs`; counts the
 * hit. Old windows are dropped as the map grows, so it cannot leak.
 */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    if (windows.size >= MAX_KEYS) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.clear();
    }
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= limit;
}
