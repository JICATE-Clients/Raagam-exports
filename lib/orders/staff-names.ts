import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Names for the people an order points at — merchandiser, owners — by id.
 *
 * WHY THE ADMIN CLIENT: those columns now reference `staff` (the parallel
 * session's FK move off the test-data `employees` master), and `staff` RLS
 * needs hr_payroll:view. A merchandiser looking at Order Progress should still
 * see who owns an order, so the lookup returns id + name and nothing else,
 * through the service role — the same narrow-read stance `creator_names()`
 * takes for Created User.
 *
 * Reads `staff` first and falls back to `employees` for ids it does not find,
 * so it is right before and after that migration lands. A failed read returns
 * no names (the screen shows "—"), never an error: a name is a label, not data
 * the page depends on.
 */
export async function staffNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (!want.length) return names;
  const admin = createAdminClient();
  const { data } = await admin.from("staff").select("id, name").in("id", want);
  for (const r of (data ?? []) as { id: string; name: string | null }[]) if (r.name) names.set(r.id, r.name);
  const missing = want.filter((id) => !names.has(id));
  if (missing.length) {
    const { data: emp } = await admin.from("employees").select("id, name").in("id", missing);
    for (const r of (emp ?? []) as { id: string; name: string | null }[]) if (r.name) names.set(r.id, r.name);
  }
  return names;
}
