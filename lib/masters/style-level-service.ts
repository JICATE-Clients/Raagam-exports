import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StyleLevel } from "./style-level-types";

export async function listStyleLevels(): Promise<StyleLevel[]> {
  const s = await createClient();
  const { data } = await s
    .from("style_levels")
    .select("*")
    .order("level_short_name", { nullsFirst: false });
  return (data ?? []) as StyleLevel[];
}
