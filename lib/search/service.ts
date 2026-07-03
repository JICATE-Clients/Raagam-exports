import "server-only";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, type AppUser } from "@/lib/auth/types";
import { SEARCH_ENTITIES, type SearchResult } from "./types";
import { rankResults } from "./rank";

/** Minimum query length before we hit the database. */
const MIN_QUERY_LENGTH = 2;
/** Rows fetched per entity table. */
const PER_ENTITY_LIMIT = 5;
/** Max results returned overall, after ranking. */
const TOTAL_LIMIT = 30;

/**
 * PostgREST `.or()` takes a comma-separated filter string where `%` is the
 * wildcard. A raw query could inject extra filters via `,` or hijack the
 * pattern via `%`/`_`, so escape those before interpolating. `\` escapes the
 * SQL LIKE metacharacters; `,`/`(`/`)` are stripped since they're PostgREST
 * filter-list syntax, not meaningful search input.
 */
function sanitizeForIlike(q: string): string {
  return q
    .replace(/[\\%_]/g, (m) => `\\${m}`)
    .replace(/[(),]/g, " ")
    .trim();
}

/**
 * Search every permitted entity table for `query` and return a unified,
 * ranked list of record hits. Nav/action results are handled on the client;
 * this only covers database records.
 *
 * Results respect RBAC: an entity is queried only when the user holds
 * `<module>:view`, so a user without `finance:view` never receives invoices —
 * the gate is server-side, not a client-side hide.
 */
export async function searchEverywhere(
  query: string,
  user: AppUser,
): Promise<SearchResult[]> {
  const raw = query.trim();
  if (raw.length < MIN_QUERY_LENGTH) return [];

  const pattern = `%${sanitizeForIlike(raw)}%`;
  if (pattern === "%%") return [];

  const supabase = await createClient();

  const allowed = SEARCH_ENTITIES.filter((e) =>
    hasPermission(user, e.module, "view"),
  );

  const settled = await Promise.all(
    allowed.map(async (entity) => {
      const columns = new Set([
        "id",
        ...(entity.select ?? []),
        ...entity.columns,
      ]);
      const orFilter = entity.columns
        .map((col) => `${col}.ilike.${pattern}`)
        .join(",");

      const { data, error } = await supabase
        .from(entity.table)
        .select([...columns].join(","))
        .or(orFilter)
        .limit(PER_ENTITY_LIMIT);

      if (error || !data) return [] as SearchResult[];

      return (data as unknown as Record<string, unknown>[]).map<SearchResult>((row) => ({
        type: entity.type,
        id: String(row.id),
        title: entity.title(row),
        subtitle: entity.subtitle(row),
        module: entity.module,
        href: entity.buildHref(row),
      }));
    }),
  );

  const results = settled.flat();
  return rankResults(results, raw).slice(0, TOTAL_LIMIT);
}
