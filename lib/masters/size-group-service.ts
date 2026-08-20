import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { SizeGroup } from "./size-group-types";

export async function listSizeGroups(): Promise<SizeGroup[]> {
  const s = await createClient();
  const { data } = await s
    .from("size_groups")
    // `size_id` (0438) is what lets a caller map a group onto the Sizes master's
    // option ids. Selecting it here rather than at the one call site that needs
    // it: this is the only reader of the table, and a service that returns
    // `size_name` alone is what the Sizes picker would have had to re-resolve by
    // NAME — which is the binding 0438 exists to replace.
    .select("*, sizes:size_group_sizes(id, size_name, size_id, sort_order)")
    .order("size_group_name", { nullsFirst: false });
  return withCreators((data ?? []) as SizeGroup[]);
}
