import { redirect } from "next/navigation";

/**
 * TRANSPORT OPENS ON ITS OVERVIEW (2026-11-06, wave 2 of the module overviews). It was
 * `ModuleHub`, which only redirected to the first sub-module. The overview has its own row
 * (`/logistics/transport/overview`, first in `lib/nav/module-groups.ts`), so it lights when
 * open; the module root just sends you there, carrying the query (`?who=`).
 */
export default async function TransportRootPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) q.append(k, x);
  const s = q.toString();
  redirect(s ? `/logistics/transport/overview?${s}` : "/logistics/transport/overview");
}
