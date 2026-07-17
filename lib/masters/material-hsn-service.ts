import "server-only";
import { createClient } from "@/lib/supabase/server";

// ============================================================================
// HSN Assign to Materials (Materials). A bulk-edit grid over the existing
// `items` master (the Material master): list every item + its HSN (hsn_id, a FK
// to config_lookups kind 'hsn_code'), plus read-only identity / class / category
// / status columns for filtering. No own table — a lean read + a one-column bulk
// update. Mirrors the TCS / GST-assign patterns. Replaces the legacy
// "HSN Assign to Material — By Item" 2-step wizard.
//
// NOTE: `items.hsn_id` (0231) is the FK we assign; the older `items.hsn_code`
// text is legacy and left untouched. No migration.
// ============================================================================

export interface MaterialHsnRow {
  id: string;
  code: string | null; // "Short Name"
  name: string; // legacy "Item"
  is_active: boolean; // Inactive = !is_active
  item_class_id: string | null; // config_lookups 'item_class'
  category_id: string | null; // public.categories
  hsn_id: string | null; // config_lookups 'hsn_code'
}

export async function listMaterialHsn(): Promise<MaterialHsnRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("items")
    .select("id, code, name, is_active, item_class_id, category_id, hsn_id")
    .order("name");
  return (data ?? []) as MaterialHsnRow[];
}
