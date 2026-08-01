import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DupGuardResult =
  | { ok: true }
  /**
   * `kind` exists because the two failures are NOT interchangeable to a client.
   *
   * On save they still are: both block, and every action branches on `ok` alone.
   * But the real-time hint now HOLDS THE CURSOR on the field (see the hold in
   * components/shell/keyboard-nav-provider.tsx), and holding on "permission
   * denied for table items" is a cage the operator cannot type their way out of
   * — every re-check fails identically, so the value can never clear it. A
   * duplicate clears the moment they edit the name; a broken query never does.
   *
   * `useDuplicateCheck` therefore holds only on `kind: "duplicate"` and stays
   * silent on `"failed"`, letting the on-save guard be authoritative as before.
   */
  | { ok: false; kind: "duplicate" | "failed"; error: string };

/**
 * Case-insensitive, trimmed exact-match duplicate check on a "name" column.
 * One shared implementation so every master's create/update path rejects
 * accidental duplicates the same way, without each action file re-querying
 * by hand. `ilike` without wildcards is an exact case-insensitive match in
 * Postgres, so this catches "Cotton" vs "cotton " but not a substring.
 */
export async function checkDuplicateName(
  s: SupabaseClient,
  table: string,
  name: string | null | undefined,
  opts: {
    /** Column holding the display name. Default "name". */
    nameColumn?: string;
    /** Primary key column. Default "id". */
    idColumn?: string;
    /** Omit the row being updated from the collision check. */
    excludeId?: string;
    /** Extra eq()/is() filters that scope the check (e.g. { item_class_id } or { kind }). */
    scope?: Record<string, string | null>;
    /** Word used in the error message ("name", "code", ...). Default "name". */
    label?: string;
  } = {},
): Promise<DupGuardResult> {
  const trimmed = name?.trim();
  if (!trimmed) return { ok: true }; // blank name — nothing to dedupe on

  const nameColumn = opts.nameColumn ?? "name";
  const idColumn = opts.idColumn ?? "id";
  const label = opts.label ?? "name";

  let q = s.from(table).select(idColumn).ilike(nameColumn, trimmed);
  for (const [col, val] of Object.entries(opts.scope ?? {})) {
    q = val === null ? q.is(col, null) : q.eq(col, val);
  }
  if (opts.excludeId) q = q.neq(idColumn, opts.excludeId);

  const { data, error } = await q.limit(1);
  // A QUERY THAT FAILED IS NOT A COLLISION. Same `ok: false` for the save path,
  // but tagged so the live hint can tell "this name is taken" from "I could not
  // find out" — see the note on DupGuardResult.
  if (error) return { ok: false, kind: "failed", error: error.message };
  if (data && data.length > 0) {
    return { ok: false, kind: "duplicate", error: `"${trimmed}" already exists. Use a different ${label}.` };
  }
  return { ok: true };
}
