import { redirect } from "next/navigation";

/**
 * STORES OPENS ON ITS OVERVIEW (2026-11-06, wave 3 of the module overviews). It was a card grid of four Purchase screens and a tile per store; the store screens moved to Purchase on 2026-11-02. The
 * overview has its own sidebar row (`/stores/overview`, first in `lib/nav/module-groups.ts`); the
 * module root just sends you there, carrying the query.
 */
export default async function StoresRootPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) q.append(k, x);
  const s = q.toString();
  redirect(s ? `/stores/overview?${s}` : "/stores/overview");
}
