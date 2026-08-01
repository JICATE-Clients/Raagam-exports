import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteGuardResult =
  | { ok: true; inactive: false; usedBy?: undefined }
  | { ok: true; inactive: true; usedBy?: string }
  | { ok: false; error: string };

/** "material_mixings" → "Material Mixings" — friendly name for the
 *  referencing table. Exported for `deleteParty`, whose verdict comes back from
 *  the DB as a raw table name and must read the same as every other master's. */
export function humanizeTable(table: string): string {
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
 * Ask the DB whether `id` is still referenced by any non-cascade FK. Returns the
 * humanized child-table name (e.g. "Material Mixings") or undefined. Proactive —
 * catches `ON DELETE SET NULL` references that a delete-then-catch-23503 approach
 * misses (migration 0344 `first_referencing_table`). Swallows RPC errors and
 * returns undefined so the caller falls through to the delete + 23503 fallback.
 */
async function referencedBy(
  s: SupabaseClient,
  table: string,
  id: string,
): Promise<string | undefined> {
  const { data, error } = await s.rpc("first_referencing_table", { p_table: table, p_id: id });
  if (error || !data) return undefined;
  return humanizeTable(data as string);
}

/**
 * Delete a master row; if it's referenced elsewhere, soft-disable instead so
 * history stays intact — and report WHERE it's used (`usedBy`) so screens can
 * tell the user (client 2026-07-23). One shared implementation so every master's
 * delete path gets the same deactivate-vs-delete behavior without re-checking
 * every referencing table by hand.
 *
 * "In use" is decided by a proactive catalog check (`first_referencing_table`,
 * 0344) which sees SET NULL / RESTRICT / any FK; the reactive 23503 catch on the
 * delete itself stays as a race fallback.
 */
export async function deleteOrDeactivate(
  s: SupabaseClient,
  table: string,
  id: string,
  activeColumn: "is_active" | "inactive" | "blocked" = "is_active",
): Promise<DeleteGuardResult> {
  const patch =
    activeColumn === "is_active"
      ? { is_active: false }
      : activeColumn === "blocked"
        ? { blocked: true }
        : { inactive: true };

  // Proactive: referenced (incl. SET NULL) → deactivate before any delete.
  const usedByPre = await referencedBy(s, table, id);
  if (usedByPre) {
    const { error: patchErr } = await s.from(table).update(patch).eq("id", id);
    if (patchErr) return { ok: false, error: patchErr.message };
    return { ok: true, inactive: true, usedBy: usedByPre };
  }

  const { error } = await s.from(table).delete().eq("id", id);
  if (!error) return { ok: true, inactive: false };
  // Fallback: a RESTRICT reference appeared between the check and the delete.
  if (error.code !== "23503") return { ok: false, error: error.message };
  const usedBy = referencedFrom(error);
  const { error: patchErr } = await s.from(table).update(patch).eq("id", id);
  if (patchErr) return { ok: false, error: patchErr.message };
  return { ok: true, inactive: true, usedBy };
}

export type DeleteOrBlockResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * For flag-less document/register masters (exchange-rate entries, work timings,
 * document-no formats, …) that have no active/inactive column: their own detail
 * lines cascade, so an unreferenced header deletes cleanly, but if something
 * ELSE references it we block with a clear message rather than orphan it.
 * Uses the same proactive catalog check (which ignores cascade children).
 */
export async function deleteOrBlock(
  s: SupabaseClient,
  table: string,
  id: string,
): Promise<DeleteOrBlockResult> {
  const usedBy = await referencedBy(s, table, id);
  if (usedBy) return { ok: false, error: `In use by ${usedBy} — cannot delete.` };

  const { error } = await s.from(table).delete().eq("id", id);
  if (!error) return { ok: true };
  if (error.code === "23503") {
    const ref = referencedFrom(error);
    return { ok: false, error: `In use${ref ? ` by ${ref}` : ""} — cannot delete.` };
  }
  return { ok: false, error: error.message };
}
