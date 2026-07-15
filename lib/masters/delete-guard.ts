import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteGuardResult =
  | { ok: true; inactive: false }
  | { ok: true; inactive: true }
  | { ok: false; error: string };

/**
 * Delete a master row; if Postgres rejects it with a foreign-key violation
 * (23503) because it's referenced elsewhere, soft-disable instead so history
 * stays intact. One shared implementation so every master's delete path gets
 * the same deactivate-vs-delete behavior without re-checking every
 * referencing table by hand.
 */
export async function deleteOrDeactivate(
  s: SupabaseClient,
  table: string,
  id: string,
  activeColumn: "is_active" | "inactive" = "is_active",
): Promise<DeleteGuardResult> {
  const { error } = await s.from(table).delete().eq("id", id);
  if (!error) return { ok: true, inactive: false };
  if (error.code !== "23503") return { ok: false, error: error.message };
  const patch = activeColumn === "is_active" ? { is_active: false } : { inactive: true };
  const { error: patchErr } = await s.from(table).update(patch).eq("id", id);
  if (patchErr) return { ok: false, error: patchErr.message };
  return { ok: true, inactive: true };
}
