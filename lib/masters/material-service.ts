import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Material } from "./material-types";

export async function listMaterials(): Promise<Material[]> {
  const s = await createClient();
  const { data } = await s
    .from("items")
    .select(
      "*, mixings:material_mixings!material_mixings_item_id_fkey(*), conversions:material_uom_conversions(*), using_items:material_using_items!material_using_items_item_id_fkey(*)",
    )
    .order("name");
  return ((data ?? []) as Material[]).map((m) => ({
    ...m,
    mixings: [...(m.mixings ?? [])].sort((a, b) => a.sno - b.sno),
    conversions: [...(m.conversions ?? [])].sort((a, b) => a.sno - b.sno),
    using_items: [...(m.using_items ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}

/** Yarn duplicate-detection (0279): a yarn is identified by count+category+purity —
 *  find an existing yarn item with the same combination (excluding `excludeId` on
 *  update), so the caller can block the save before it creates a duplicate record. */
export async function findDuplicateYarn(
  itemClassId: string,
  countId: string | null,
  categoryId: string | null,
  purityId: string | null,
  excludeId?: string,
): Promise<{ id: string; name: string } | null> {
  const s = await createClient();
  let q = s.from("items").select("id, name").eq("item_class_id", itemClassId);
  q = countId ? q.eq("count_id", countId) : q.is("count_id", null);
  q = categoryId ? q.eq("category_id", categoryId) : q.is("category_id", null);
  q = purityId ? q.eq("purity_id", purityId) : q.is("purity_id", null);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q.limit(1).maybeSingle();
  return data;
}
