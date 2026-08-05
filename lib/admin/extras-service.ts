import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Asset, AssetAssignment, Courier, CourierDespatch } from "./extras-types";
import { withCreators } from "@/lib/created-by";

export type LocationOption = { id: string; code: string; name: string };
/** A Capital Goods material offered as an asset name (0350). `category` is the
 *  category NAME, not an id — it is copied straight onto the asset's free-text
 *  `category` column when the material is picked. Shaped by the assets page
 *  from the material/category masters; deliberately tiny. */
export type AssetItemOption = { id: string; name: string; category: string | null };
export type CourierOption = { id: string; code: string | null; name: string; is_active: boolean };

function joined(row: Record<string, unknown>, rel: string, field: string): string | null {
  const r = row[rel] as Record<string, unknown> | null;
  return (r?.[field] as string | null) ?? null;
}

export async function getLocations(): Promise<LocationOption[]> {
  const s = await createClient();
  const { data } = await s.from("locations").select("id, code, name").eq("is_active", true).order("code");
  return (data ?? []) as LocationOption[];
}

// ---------- assets ----------
export interface AssetWithRefs extends Asset {
  location_code: string | null;
  /** Name of the linked Capital Goods material, if any (0350). */
  item_name: string | null;
}
export async function listAssets(): Promise<AssetWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("assets")
    .select("*, locations(code), items(name)")
    .order("created_at", { ascending: false });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as Asset),
    location_code: joined(r, "locations", "code"),
    item_name: joined(r, "items", "name"),
  })));
}
export async function getAsset(id: string): Promise<AssetWithRefs | null> {
  const s = await createClient();
  const { data } = await s
    .from("assets")
    .select("*, locations(code), items(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    ...(r as unknown as Asset),
    location_code: joined(r, "locations", "code"),
    item_name: joined(r, "items", "name"),
  };
}
export async function getAssetAssignments(assetId: string): Promise<AssetAssignment[]> {
  const s = await createClient();
  const { data } = await s
    .from("asset_assignments")
    .select("*")
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false });
  return (data ?? []) as AssetAssignment[];
}

// ---------- couriers ----------
export async function listCouriers(): Promise<Courier[]> {
  const s = await createClient();
  const { data } = await s.from("couriers").select("*").order("name");
  return withCreators((data ?? []) as Courier[]);
}
export async function getCourierOptions(): Promise<CourierOption[]> {
  const s = await createClient();
  // Flag selected, not filtered on — the Customer editor's Preferred Courier must
  // still resolve a courier that was retired after that customer was set up.
  const { data } = await s.from("couriers").select("id, code, name, is_active").order("name");
  return (data ?? []) as CourierOption[];
}
export interface CourierDespatchWithRefs extends CourierDespatch {
  courier_name: string | null;
}
export async function listCourierDespatches(): Promise<CourierDespatchWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("courier_despatches")
    .select("*, couriers(name)")
    .order("created_at", { ascending: false });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as CourierDespatch),
    courier_name: joined(r, "couriers", "name"),
  })));
}
