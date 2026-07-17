import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SizeGroup } from "./size-group-types";

export async function listSizeGroups(): Promise<SizeGroup[]> {
  const s = await createClient();
  const { data } = await s
    .from("size_groups")
    .select("*, sizes:size_group_sizes(id, size_name, sort_order)")
    .order("size_group_name", { nullsFirst: false });
  return (data ?? []) as SizeGroup[];
}
