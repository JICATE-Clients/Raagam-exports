"use server";

import { allow, clientIp } from "@/lib/rate-limit";
import { withdrawByToken } from "@/lib/resolve/tracking";
import { isTrackingToken } from "@/lib/resolve/token";

const TOO_MANY = "Too many attempts. Please wait a minute and try again.";
const NOT_FOUND = "No complaint matches this link.";

/**
 * Withdraw an anonymous complaint from its tracking page. PUBLIC — no session,
 * so the token is the whole authorisation; the service-role RPC behind
 * `withdrawByToken` re-checks it (hash match, not already resolved) and writes
 * the activity with no actor. Rate limited per address; shape-checked first.
 * The token is never logged.
 */
export async function withdrawTracked(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!allow(`track-withdraw:${await clientIp()}`, 10, 60_000)) return { ok: false, error: TOO_MANY };
  if (!isTrackingToken(token)) return { ok: false, error: NOT_FOUND };
  const res = await withdrawByToken(token);
  if (!res.ok) return { ok: false, error: res.error };
  // No revalidatePath: the page is force-dynamic and the button refreshes it,
  // so the token never has to be handed to the cache layer as a path.
  return { ok: true };
}
