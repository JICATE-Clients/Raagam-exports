import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Brand } from "./brand-types";

export async function listBrands(): Promise<Brand[]> {
  const s = await createClient();
  const { data } = await s
    .from("brands")
    .select("*, country:countries(id,code,name)")
    .order("brand_name", { nullsFirst: false });
  return (data ?? []) as Brand[];
}
