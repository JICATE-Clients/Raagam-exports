import "server-only";
import { createClient } from "@/lib/supabase/server";

// ============================================================================
// Simple master list functions — one per table.
// These match the actions in simple-master-actions.ts.
//
// `created_at` is selected on every one of them and shown by no column. It
// feeds the Created Date filter, which `useMasterFilter` offers only when the
// rows actually carry the value (lib/date-filter.ts) — so dropping it from a
// select here does not break a build or a type, it just silently removes the
// filter from that screen. Keep it in the list.
// ============================================================================

export async function listYarnCompositions() {
  const s = await createClient();
  const { data } = await s
    .from("yarn_compositions")
    .select("id, code, name, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string; is_active: boolean; created_at: string }[];
}

export async function listDefectGroupsSimple() {
  const s = await createClient();
  const { data } = await s
    .from("defect_groups")
    .select("id, code, name, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string; is_active: boolean; created_at: string }[];
}

export async function listStyleStockCategories() {
  const s = await createClient();
  const { data } = await s
    .from("style_stock_categories")
    .select("id, code, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; is_active: boolean; created_at: string }[];
}

export async function listSpecialInstructions() {
  const s = await createClient();
  const { data } = await s
    .from("special_instructions")
    .select("id, code, description, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; description: string; is_active: boolean; created_at: string }[];
}

export async function listBeamTypesSimple() {
  const s = await createClient();
  const { data } = await s
    .from("beam_types")
    .select("id, code, name, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string; is_active: boolean; created_at: string }[];
}

export async function listDesigns() {
  const s = await createClient();
  const { data } = await s
    .from("designs")
    .select("id, name, is_active, created_at")
    .order("name");
  return (data ?? []) as { id: string; name: string; is_active: boolean; created_at: string }[];
}

export async function listDomesticProductDesigns() {
  const s = await createClient();
  const { data } = await s
    .from("domestic_product_designs")
    .select("id, design_no, description, is_active, created_at")
    .order("design_no");
  return (data ?? []) as { id: string; design_no: string; description: string; is_active: boolean; created_at: string }[];
}

export async function listLabTestStandards() {
  const s = await createClient();
  const { data } = await s
    .from("lab_test_standards")
    .select("id, code, name, category, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string; category: string | null; is_active: boolean; created_at: string }[];
}

export async function listProductTypes() {
  const s = await createClient();
  const { data } = await s
    .from("product_types")
    .select("id, code, name, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string; is_active: boolean; created_at: string }[];
}
