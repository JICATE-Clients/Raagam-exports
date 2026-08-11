import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { disablePatch, type ActiveColumn } from "@/lib/masters/inactive";

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
 * The answer to "is this row still referenced?" — and, separately, whether we
 * GOT an answer.
 *
 * `known: false` is not a third kind of reference, it is the absence of a
 * verdict, and the two must never collapse into one value. They did: this
 * helper used to return `string | undefined` and hand back `undefined` for both
 * "nothing references it" and "the RPC failed", so a failed check read as a
 * clean bill of health.
 */
type ReferenceCheck = { known: true; usedBy?: string } | { known: false; error: string };

/**
 * Ask the DB whether `id` is still referenced by any non-cascade FK. Proactive —
 * catches `ON DELETE SET NULL` references that a delete-then-catch-23503 approach
 * misses (migration 0344 `first_referencing_table`).
 *
 * IT FAILS CLOSED, and the reason is the FK shape 0344 exists for. This used to
 * swallow the RPC error and return "not referenced", letting the caller fall
 * through to the delete + 23503 fallback — but a `SET NULL` child raises NO
 * error, so the delete succeeded and the child was silently blanked. That is
 * precisely the behaviour 0344 replaced (see the sentence above), so on any RPC
 * failure the guard degraded to the exact bug it was written to fix, and did it
 * without a single log line. The caller now refuses instead.
 *
 * "Any failure" is deliberately wide — a revoked EXECUTE grant, a renamed RPC, a
 * network blip, a future RLS change. A guard that only holds while everything
 * else is healthy is not a guard; the operator loses a delete they could have
 * had, which is recoverable, instead of a reference they cannot get back.
 */
async function referencedBy(s: SupabaseClient, table: string, id: string): Promise<ReferenceCheck> {
  const { data, error } = await s.rpc("first_referencing_table", { p_table: table, p_id: id });
  if (error) return { known: false, error: error.message };
  if (!data) return { known: true };
  return { known: true, usedBy: humanizeTable(data as string) };
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
  activeColumn: ActiveColumn = "is_active",
): Promise<DeleteGuardResult> {
  // One definition of "switch this row off", shared with `lib/data-io`'s bulk
  // delete — the two had drifted, and the copy that drifted was wrong. See
  // `disablePatch`.
  const patch = disablePatch(activeColumn);

  // Proactive: referenced (incl. SET NULL) → deactivate before any delete.
  const pre = await referencedBy(s, table, id);
  // NO VERDICT MEANS NO DELETE. Falling through to the delete would rely on the
  // 23503 catch below, which cannot see a SET NULL child — the row would go and
  // take its references' meaning with it. See `referencedBy`.
  if (!pre.known) {
    return { ok: false, error: `Could not check whether this is in use — not deleted. (${pre.error})` };
  }
  if (pre.usedBy) {
    const { error: patchErr } = await s.from(table).update(patch).eq("id", id);
    if (patchErr) return { ok: false, error: patchErr.message };
    return { ok: true, inactive: true, usedBy: pre.usedBy };
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
  const pre = await referencedBy(s, table, id);
  // Same fail-closed rule as `deleteOrDeactivate`. It matters MORE here: these
  // masters have no active flag, so there is no soft-disable to fall back on —
  // the row either survives intact or is gone.
  if (!pre.known) {
    return { ok: false, error: `Could not check whether this is in use — not deleted. (${pre.error})` };
  }
  if (pre.usedBy) return { ok: false, error: `In use by ${pre.usedBy} — cannot delete.` };

  const { error } = await s.from(table).delete().eq("id", id);
  if (!error) return { ok: true };
  if (error.code === "23503") {
    const ref = referencedFrom(error);
    return { ok: false, error: `In use${ref ? ` by ${ref}` : ""} — cannot delete.` };
  }
  return { ok: false, error: error.message };
}
