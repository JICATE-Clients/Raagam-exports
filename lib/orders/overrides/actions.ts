"use server";

/**
 * Permission overrides — the admin doors (0651). Thin on purpose: the RPCs
 * carry every rule (manager gate, no self-grant, active grantee who can edit
 * orders, expiry window, reason) inside one transaction with the history row,
 * so a door that skipped this file would be refused just the same. The checks
 * here only answer sooner, in the same words.
 *
 * No `export type` from this file — a "use server" module that re-exports a
 * type crashes at runtime (memory raagam-use-server-type-reexport). Types live
 * in ./types.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/server";
import { expiryProblem, normalizeEmail } from "./override-modules";
import { grantOverrideInput, revokeOverrideInput, type OverrideGrantHistoryRow } from "./types";
import { getOverrideGrantHistory } from "./service";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const SCREEN = "/admin/permission-overrides";

export async function grantOverride(payload: unknown): Promise<Result<{ granted: number }>> {
  await requireUser();
  const p = grantOverrideInput.safeParse(payload);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input" };

  const expiry = new Date(p.data.expiresAt);
  const problem = expiryProblem(expiry, new Date());
  if (problem) return { ok: false, error: problem };

  const s = await createClient();
  const { data, error } = await s.rpc("grant_permission_override", {
    p_email: normalizeEmail(p.data.email),
    p_keys: p.data.keys,
    p_expiry: expiry.toISOString(),
    p_reason: p.data.reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(SCREEN);
  return { ok: true, granted: typeof data === "number" ? data : p.data.keys.length };
}

/** One grant's history for the History sheet (R-14) — read on demand. RLS
 *  answers who may see it; a refused read comes back as the error. */
export async function loadGrantHistory(overrideId: string): Promise<Result<{ rows: OverrideGrantHistoryRow[] }>> {
  await requireUser();
  try {
    return { ok: true, rows: await getOverrideGrantHistory(overrideId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the history." };
  }
}

export async function revokeOverride(payload: unknown): Promise<Result> {
  await requireUser();
  const p = revokeOverrideInput.safeParse(payload);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input" };

  const s = await createClient();
  const { error } = await s.rpc("revoke_permission_override", { p_id: p.data.id, p_reason: p.data.reason });
  if (error) return { ok: false, error: error.message };
  revalidatePath(SCREEN);
  return { ok: true };
}
