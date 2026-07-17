import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PackingMethod } from "./packing-method-types";

export async function listPackingMethods(): Promise<PackingMethod[]> {
  const s = await createClient();
  const { data } = await s
    .from("packing_methods")
    .select("*, categories:packing_method_categories(id, sort_order, category_name)")
    .order("packing_type", { nullsFirst: false });
  return (data ?? []) as PackingMethod[];
}
