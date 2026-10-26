import "server-only";
import { withCreators } from "@/lib/created-by";
import { createClient } from "@/lib/supabase/server";
import type { CatalogAreaRow, CatalogItemRow, CatalogRouting, RoutingCode } from "./catalog-types";

/*
 * Problem Catalog reads for Administration (0751). Every read runs as the
 * operator under RLS. A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
 * Inactive rows are included — the admin screen is where they come back on.
 */

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/** Every area and every item, in the order the chat offers them. */
export async function listCatalog(): Promise<{ areas: CatalogAreaRow[]; items: CatalogItemRow[] }> {
  const s = await createClient();
  const [areasRes, itemsRes] = await Promise.all([
    s
      .from("rh_catalog_areas")
      .select("id, lane, code, label, icon, details, sort, inactive, created_by, created_at")
      .order("lane")
      .order("sort")
      .order("label"),
    s
      .from("rh_catalog_items")
      .select(
        "id, area_id, code, label, synonyms, details, dangerous, trade_code, sd_category_code, complaint_category_code, sort, inactive, used_count, created_by, created_at",
      )
      .order("sort")
      .order("label"),
  ]);
  const areas = (must(areasRes, "Reading catalog areas") ?? []) as CatalogAreaRow[];
  const items = (must(itemsRes, "Reading catalog problems") ?? []) as CatalogItemRow[];
  const [a, i] = await Promise.all([withCreators(areas), withCreators(items)]);
  return { areas: a, items: i };
}

/**
 * The codes a catalog item may route to: trades (shared), and the CURRENT
 * unit's IT and complaint categories (per unit — RLS scopes them). A code
 * another unit uses but this one lacks is simply not offered here.
 */
export async function listCatalogRouting(): Promise<CatalogRouting> {
  const s = await createClient();
  const [t, sd, cmp] = await Promise.all([
    s.from("rh_trades").select("code, name, inactive").order("name"),
    s.from("rh_sd_categories").select("code, name, inactive").order("name"),
    s.from("rh_complaint_categories").select("code, name, inactive").order("name"),
  ]);
  const rows = (r: typeof t, what: string) => (must(r, what) ?? []) as RoutingCode[];
  return {
    trades: rows(t, "Reading trades"),
    it: rows(sd, "Reading IT categories"),
    concern: rows(cmp, "Reading complaint categories"),
  };
}
