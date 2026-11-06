import { redirect } from "next/navigation";

/**
 * PLANNING OPENS ON ITS OVERVIEW (user 2026-11-06: "add an overview page in sidebar"). The
 * overview has its own address and its own sidebar row (`/planning/overview`, first in
 * `lib/nav/module-groups.ts`), so the row lights when you are on it; the module root just
 * sends you there, carrying the query (`?who=`), so clicking the module still lands on it.
 * A REDIRECT, never a page of its own — two addresses for one page would be two rows.
 */
export default async function PlanningRootPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) q.append(k, x);
  const s = q.toString();
  redirect(s ? `/planning/overview?${s}` : "/planning/overview");
}
