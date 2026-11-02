import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { CategoryTiming } from "./category-timing-types";

/** Every dated revision of every category's hours, oldest first (0774). */
export async function listCategoryTimings(): Promise<CategoryTiming[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("hr_category_timings")
    // `*`, not a column list: the break columns (0775) arrive with the migration,
    // and naming them before it is applied would fail the whole read.
    .select("*")
    .order("effective_from", { ascending: true });
  // A failed read is an error, not "no hours set" — the two look the same on
  // screen and mean opposite things.
  if (error) console.error("[category-timings] list failed", error);
  return withCreators((data ?? []) as CategoryTiming[]);
}
