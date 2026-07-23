import "server-only";
import { type createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Auto-generate a unique code from a name — masters forms no longer ask users
 * for codes (client 2026-07-23): uppercase alphanumerics of the name, then
 * 2, 3… suffixes on collision. Uniqueness is checked against `table.codeColumn`,
 * optionally scoped (e.g. config_lookups codes are unique per `kind`).
 *
 * Generation is best-effort against races — the table's unique constraint is
 * still the real guard; a clash there surfaces as a normal insert error.
 */
export async function generateUniqueCode(
  s: Db,
  table: string,
  name: string,
  opts?: { codeColumn?: string; maxLen?: number; scope?: { column: string; value: string } },
): Promise<string> {
  const col = opts?.codeColumn ?? "code";
  const base =
    name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, opts?.maxLen ?? 10) || "ITEM";
  for (let i = 1; i <= 99; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    let q = s.from(table).select("id").eq(col, candidate).limit(1);
    if (opts?.scope) q = q.eq(opts.scope.column, opts.scope.value);
    const { data } = await q;
    if (!data?.length) return candidate;
  }
  return `${base}${Date.now() % 10000}`; // practically unreachable
}
