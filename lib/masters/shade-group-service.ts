import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ShadeGroup } from "./shade-group-types";

export async function listShadeGroups(): Promise<ShadeGroup[]> {
  const s = await createClient();
  const { data } = await s
    .from("shade_groups")
    .select("*, shades(id, shade_id, short_name, shade_name)")
    .order("name", { nullsFirst: false });
  return (data ?? []) as ShadeGroup[];
}
