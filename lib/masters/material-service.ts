import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Material } from "./material-types";

export async function listMaterials(): Promise<Material[]> {
  const s = await createClient();
  const { data } = await s
    .from("items")
    .select(
      "*, mixings:material_mixings!material_mixings_item_id_fkey(*), conversions:material_uom_conversions(*), using_items:material_using_items!material_using_items_item_id_fkey(*), item_attribute_values(*)",
    )
    .order("name");
  return ((data ?? []) as Material[]).map((m) => ({
    ...m,
    mixings: [...(m.mixings ?? [])].sort((a, b) => a.sno - b.sno),
    conversions: [...(m.conversions ?? [])].sort((a, b) => a.sno - b.sno),
    using_items: [...(m.using_items ?? [])].sort((a, b) => a.sno - b.sno),
    item_attribute_values: [...(m.item_attribute_values ?? [])].sort((a, b) => a.sno - b.sno),
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

/** Attribute-spec duplicate-detection (SEW/PACK): an item is identified by its
 *  exact set of answered attributes within an item-class + category — find an
 *  existing item with the same combination (excluding `excludeId` on update),
 *  so the caller can block the save before it creates a duplicate record. */
export async function findDuplicateBySpec(
  itemClassId: string,
  categoryId: string | null,
  answers: { attribute_line_id: string | null; value: string | null }[],
  excludeId?: string,
): Promise<{ id: string; name: string } | null> {
  const s = await createClient();
  let q = s
    .from("items")
    .select("id, name, item_attribute_values(attribute_line_id, value)")
    .eq("item_class_id", itemClassId);
  q = categoryId ? q.eq("category_id", categoryId) : q.is("category_id", null);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;

  // Build the target spec: only answers with a non-empty value.
  const wanted = new Map<string, string>();
  for (const a of answers) {
    const v = (a.value ?? "").trim();
    if (a.attribute_line_id && v) wanted.set(a.attribute_line_id, v);
  }

  for (const cand of (data ?? []) as { id: string; name: string; item_attribute_values: { attribute_line_id: string | null; value: string | null }[] }[]) {
    const have = new Map<string, string>();
    for (const a of cand.item_attribute_values ?? []) {
      const v = (a.value ?? "").trim();
      if (a.attribute_line_id && v) have.set(a.attribute_line_id, v);
    }
    if (have.size !== wanted.size) continue;
    let match = true;
    for (const [lineId, v] of wanted) {
      if (have.get(lineId) !== v) {
        match = false;
        break;
      }
    }
    if (match) return { id: cand.id, name: cand.name };
  }
  return null;
}
