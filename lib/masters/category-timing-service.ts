import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { CategoryTiming } from "./category-timing-types";

/** Every dated revision of every category's hours, oldest first (0774). */
export async function listCategoryTimings(): Promise<CategoryTiming[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("hr_category_timings")
    .select("id, category_id, in_time, out_time, grace_minutes, effective_from, created_at, created_by, updated_at")
    .order("effective_from", { ascending: true });
  // A failed read is an error, not "no hours set" — the two look the same on
  // screen and mean opposite things.
  if (error) console.error("[category-timings] list failed", error);
  return withCreators((data ?? []) as CategoryTiming[]);
}
