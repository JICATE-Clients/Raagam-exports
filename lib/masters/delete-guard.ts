import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteGuardResult =
  | { ok: true; inactive: false; usedBy?: undefined }
  | { ok: true; inactive: true; usedBy?: string }
  | { ok: false; error: string };

/** "material_mixings" → "Material Mixings" — friendly name for the
 *  referencing table pulled out of the FK violation detail. */
function humanizeTable(table: string): string {
  return table
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Postgres 23503 detail: `Key (id)=(…) is still referenced from table "xxx".` */
function referencedFrom(error: { details?: string | null; message: string }): string | undefined {
  const m = /referenced from table "([^"]+)"/.exec(error.details ?? error.message);
  return m ? humanizeTable(m[1]) : undefined;
}

/**
 * Delete a master row; if Postgres rejects it with a foreign-key violation
 * (23503) because it's referenced elsewhere, soft-disable instead so history
 * stays intact — and report WHERE it's used (`usedBy`) so screens can tell
 * the user (client 2026-07-23). One shared implementation so every master's
 * delete path gets the same deactivate-vs-delete behavior without re-checking
 * every referencing table by hand.
 */
export async function deleteOrDeactivate(
  s: SupabaseClient,
  table: string,
  id: string,
  activeColumn: "is_active" | "inactive" | "blocked" = "is_active",
): Promise<DeleteGuardResult> {
  const { error } = await s.from(table).delete().eq("id", id);
  if (!error) return { ok: true, inactive: false };
  if (error.code !== "23503") return { ok: false, error: error.message };
  const usedBy = referencedFrom(error);
  const patch =
    activeColumn === "is_active"
      ? { is_active: false }
      : activeColumn === "blocked"
        ? { blocked: true }
        : { inactive: true };
  const { error: patchErr } = await s.from(table).update(patch).eq("id", id);
  if (patchErr) return { ok: false, error: patchErr.message };
  return { ok: true, inactive: true, usedBy };
}
