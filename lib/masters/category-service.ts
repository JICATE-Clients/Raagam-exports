import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Category } from "./category-types";

/**
 * The creator embed that used to sit in this select — `creator:profiles!
 * created_by(full_name)` — resolved to null for every record created by
 * somebody else, because `profiles_read_own` (0001_foundation.sql:150) lets a
 * non-admin read only their own profile row. `withCreators` goes through the
 * SECURITY DEFINER `creator_names()` RPC added in 0383.
 *
 * The sub-category sort stays here: it is this master's own shape, not audit
 * plumbing.
 */
export async function listCategories(): Promise<Category[]> {
  const s = await createClient();
  const { data } = await s
    .from("categories")
    .select("*, sub_categories:category_sub_categories(*)")
    .order("name", { nullsFirst: false });
  const rows = (data ?? []).map((r) => {
    const row = r as unknown as Category;
    return {
      ...row,
      sub_categories: [...(row.sub_categories ?? [])].sort((a, b) => a.sno - b.sno),
    } as Category;
  });
  return withCreators(rows);
}
