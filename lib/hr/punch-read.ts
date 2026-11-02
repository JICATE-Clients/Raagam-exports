import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/** PostgREST hands back at most this many rows per read (Supabase `db-max-rows`). */
const PAGE = 1000;
/** Pages read side by side; enough to cover a week of a full factory in ~3 waves. */
const WAVE = 8;
/** Safety rail: 200k punches is a month of ~1,800 people at both gates. */
const MAX_PAGES = 200;

export type PunchRead<T> = { rows: T[]; capped: boolean };

/**
 * EVERY PUNCH IN A WINDOW, IN PARALLEL PAGES (client 2026-11-02: HR "loading
 * time is lil bit long compared to other modules").
 *
 * The screens used to page through `punches` ONE READ AFTER ANOTHER, and each
 * read is a full round trip to Supabase (~230 ms from here). A week was 2
 * pages today, and is ~18 once all ten readers carry the whole factory — four
 * seconds of waiting in a queue for no reason. Now the FIRST read also asks
 * for the exact count, so the number of pages is known after one round trip,
 * and the rest are read side by side, `WAVE` at a time.
 *
 * Ordered by (punch_time, id) and de-duplicated by id, so a punch that lands
 * between two reads and shifts a page boundary is never counted twice.
 * A failed read THROWS: a register missing a page reads as people who never
 * punched, which is worse than an error (AGENTS.md).
 */
export async function readPunches<T extends { id: number }>(
  s: Db,
  columns: string,
  fromIso: string,
  toIso?: string,
): Promise<PunchRead<T>> {
  const page = (n: number, withCount = false) => {
    let q = s
      .from("punches")
      .select(columns, withCount ? { count: "exact" } : undefined)
      .gte("punch_time", fromIso);
    if (toIso) q = q.lt("punch_time", toIso);
    return q
      .order("punch_time", { ascending: true })
      .order("id", { ascending: true })
      .range(n * PAGE, n * PAGE + PAGE - 1);
  };

  const first = await page(0, true);
  if (first.error) throw new Error(`punches: ${first.error.message}`);
  const total = first.count ?? 0;
  const pages = Math.min(Math.ceil(total / PAGE), MAX_PAGES);

  const out = [...((first.data ?? []) as unknown as T[])];
  for (let from = 1; from < pages; from += WAVE) {
    const wave = await Promise.all(
      Array.from({ length: Math.min(WAVE, pages - from) }, (_, i) => page(from + i)),
    );
    for (const r of wave) {
      if (r.error) throw new Error(`punches: ${r.error.message}`);
      out.push(...((r.data ?? []) as unknown as T[]));
    }
  }

  const seen = new Set<number>();
  const rows = out.filter((r) => !seen.has(r.id) && (seen.add(r.id), true));
  return { rows, capped: Math.ceil(total / PAGE) > MAX_PAGES };
}
