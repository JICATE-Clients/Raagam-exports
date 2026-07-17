import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Division } from "./division-types";

export async function listDivisions(): Promise<Division[]> {
  const s = await createClient();
  const { data } = await s
    .from("divisions")
    .select("*")
    .order("division_name", { nullsFirst: false });
  return (data ?? []) as Division[];
}
