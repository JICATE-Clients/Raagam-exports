import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { Result } from "./result";
import { trackWith, withdrawWith, type TrackRpc } from "./token";
import type { TrackedComplaint } from "./types";

/*
 * The PUBLIC tracking door (`/p/track/<token>`, no session). The two RPCs are
 * service-role only (plan §10.5), so this is the one place they are called —
 * after the token's shape is checked and with only its hash. The rules live in
 * ./token.ts, where check:resolve tests them.
 */

const rpc: TrackRpc = async (fn, args) => {
  const { data, error } = await createAdminClient().rpc(fn, args);
  return { data, error };
};

/** The complaint behind a token, as the eight public keys — or null. */
export function trackComplaint(token: string): Promise<TrackedComplaint | null> {
  return trackWith(rpc, token);
}

/** Anonymous withdraw. The database records it with no actor. */
export function withdrawByToken(token: string): Promise<Result> {
  return withdrawWith(rpc, token);
}
