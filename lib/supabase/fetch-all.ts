/**
 * READ EVERY ROW, NOT THE FIRST THOUSAND (2026-11-14).
 *
 * PostgREST answers any one select — and any set-returning `.rpc()` — with at
 * most 1,000 rows, and says nothing when it stops there: the result looks
 * complete. Per-person screen blocks (0840) passed that on day two (one person
 * unticked down to Pulse = 1,306 rows), so the Users page read a fraction of
 * them, showed the rest as ticked again ("resets to all selected"), and the
 * next Save — which replaces the whole set — deleted the ones it never read.
 *
 * `page(from, to)` builds one request with `.range(from, to)` on a STABLE
 * order (order by the key), or two pages can overlap and skip rows.
 */
const PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>;

export async function fetchAll<T>(
  page: (from: number, to: number) => Page<T>,
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string; code?: string } }> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return { data: out, error: null };
  }
}
