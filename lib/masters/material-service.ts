import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Material } from "./material-types";

export async function listMaterials(): Promise<Material[]> {
  const s = await createClient();
  const { data } = await s
    .from("items")
    .select("*, mixings:material_mixings(*), conversions:material_uom_conversions(*)")
    .order("name");
  return ((data ?? []) as Material[]).map((m) => ({
    ...m,
    mixings: [...(m.mixings ?? [])].sort((a, b) => a.sno - b.sno),
    conversions: [...(m.conversions ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}
