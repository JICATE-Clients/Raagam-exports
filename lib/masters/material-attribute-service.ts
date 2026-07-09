import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MaterialAttribute } from "./material-attribute-types";

export async function listMaterialAttributes(): Promise<MaterialAttribute[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_attributes")
    .select("*, lines:material_attribute_lines(*)")
    .order("created_at");
  return ((data ?? []) as MaterialAttribute[]).map((m) => ({
    ...m,
    lines: [...(m.lines ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}
