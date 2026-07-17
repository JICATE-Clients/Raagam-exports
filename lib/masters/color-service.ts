import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Color } from "./color-types";

export async function listColors(): Promise<Color[]> {
  const s = await createClient();
  const { data } = await s
    .from("colors")
    .select("*")
    .order("color_name", { nullsFirst: false });
  return (data ?? []) as Color[];
}
