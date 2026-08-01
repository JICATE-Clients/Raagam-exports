import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve `created_by` uuids to display names — one round trip for a whole list.
 *
 * ## Why this is not a PostgREST embed
 *
 * `creator:profiles!created_by(full_name)` is what `levy-service`,
 * `category-service` and `orders/approve-amendments/service` do today, and it
 * is BROKEN: `profiles_read_own` (0001_foundation.sql:150) lets a user select
 * only their own profile row unless they hold `system_admin:view`, so the embed
 * resolves to null for every record created by anyone else. It has looked
 * correct only because `created_by` was NULL on those tables — the moment 0383
 * starts populating it, every non-admin would see "—" everywhere.
 * `creator_names()` is SECURITY DEFINER and returns nothing but id + name.
 *
 * Two further reasons for this shape:
 *
 *  - `select("*")` does not bring an embed along, and ~47 of the 60 masters
 *    services use `select("*")`. An embed would mean rewriting every select
 *    string — 60 chances to drop a column and silently kill a screen's filter.
 *    This wraps the RETURN instead and leaves the query untouched.
 *  - The seven legacy `text` tables (config_lookups, processes, components,
 *    items, exchange_rate_details — see 0290) have no FK to embed through.
 *    Their verbatim usernames fail the uuid test below, are never sent to the
 *    RPC, and reach the screen unchanged. That is exactly 0290's intent.
 *
 * Returns `T[]`, deliberately: no `*-types.ts` interface needs a new field and
 * every existing `as Country[]` cast keeps compiling. The screen reads the
 * value through `creatorName(row)` (components/ui/created-columns.tsx), which
 * takes `unknown` for the same reason.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withCreators<T>(rows: T[]): Promise<T[]> {
  const ids = Array.from(
    new Set(
      rows
        .map((r) => (r as { created_by?: unknown } | null)?.created_by)
        .filter((v): v is string => typeof v === "string" && UUID_RE.test(v)),
    ),
  );
  // No uuids to resolve — a list of legacy-text rows, or nothing created since
  // 0383. Skip the round trip entirely rather than sending an empty array.
  if (ids.length === 0) return rows;

  const s = await createClient();
  const { data } = await s.rpc("creator_names", { ids });
  const byId = new Map(
    ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name,
    ]),
  );

  return rows.map((r) => {
    const id = (r as { created_by?: unknown } | null)?.created_by;
    return typeof id === "string" && byId.has(id)
      ? { ...r, created_by_name: byId.get(id) ?? null }
      : r;
  });
}
