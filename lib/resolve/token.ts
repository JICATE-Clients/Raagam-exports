import { createHash } from "node:crypto";
import type { ComplaintStatus, TrackedComplaint } from "./types";

/*
 * The anonymous-complaint tracking token (plan §10.2) — pure, so check:resolve
 * can prove its rules without a database.
 *
 *   - 32 random bytes → base64url, no padding = exactly 43 characters.
 *   - The database stores only sha256(token) as hex. The server hashes HERE
 *     and sends the hash, so the token itself never reaches Postgres — not
 *     its statement log, not pg_stat_statements.
 *   - Anything not token-shaped is refused BEFORE a lookup is made, and the
 *     answer for "malformed" and "unknown" is the same null.
 *   - What comes back is cut to the eight keys the public page may show,
 *     whatever else the RPC returns.
 */

export const TRACKING_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isTrackingToken(v: unknown): v is string {
  return typeof v === "string" && TRACKING_TOKEN_RE.test(v);
}

/** sha256 hex of the token's UTF-8 bytes — what `tracking_token_hash` holds. */
export function hashTrackingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const STATUSES: ReadonlySet<string> = new Set<ComplaintStatus>([
  "open",
  "assigned",
  "in_progress",
  "escalated",
  "resolved",
  "withdrawn",
]);

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Exactly the TrackedComplaint keys — never a field more. Null when the row
 *  is not a usable answer. */
export function pickTracked(raw: unknown): TrackedComplaint | null {
  const r = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") return null;
  const ref = str(r.ref_no);
  const status = str(r.status);
  const created = str(r.created_at);
  if (!ref || !status || !STATUSES.has(status) || !created) return null;
  return {
    ref_no: ref,
    subject: str(r.subject) ?? "",
    status: status as ComplaintStatus,
    created_at: created,
    first_response_at: str(r.first_response_at),
    resolved_at: str(r.resolved_at),
    withdrawn_at: str(r.withdrawn_at),
    resolution_message: str(r.resolution_message),
  };
}

/** The RPC call the tracker makes — injected so the check can spy on it. */
export type TrackRpc = (
  fn: "rh_track_complaint" | "rh_track_withdraw",
  args: { p_token_hash: string },
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

export async function trackWith(rpc: TrackRpc, token: unknown): Promise<TrackedComplaint | null> {
  if (!isTrackingToken(token)) return null;
  const { data, error } = await rpc("rh_track_complaint", { p_token_hash: hashTrackingToken(token) });
  if (error) {
    if (error.code === "P0001") return null; // unknown token — same answer as malformed
    throw new Error(error.message);
  }
  return pickTracked(data);
}

export const TRACK_NOT_FOUND = "This tracking link is not recognised.";

export async function withdrawWith(
  rpc: TrackRpc,
  token: unknown,
): Promise<{ ok: true; data: undefined } | { ok: false; error: string }> {
  if (!isTrackingToken(token)) return { ok: false, error: TRACK_NOT_FOUND };
  const { error } = await rpc("rh_track_withdraw", { p_token_hash: hashTrackingToken(token) });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "The complaint could not be withdrawn. Try again." };
  return { ok: true, data: undefined };
}
