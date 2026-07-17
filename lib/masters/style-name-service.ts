import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StyleName } from "./style-name-types";

export async function listStyleNames(): Promise<StyleName[]> {
  const s = await createClient();
  const { data } = await s
    .from("style_names")
    .select("*")
    .order("short_name", { nullsFirst: false });
  return (data ?? []) as StyleName[];
}
