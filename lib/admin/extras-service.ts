import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Asset, AssetAssignment, Courier, CourierDespatch } from "./extras-types";

export type LocationOption = { id: string; code: string; name: string };
export type CourierOption = { id: string; code: string | null; name: string };

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
}
export async function listAssets(): Promise<AssetWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("assets")
    .select("*, locations(code)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as Asset),
    location_code: joined(r, "locations", "code"),
  }));
}
export async function getAsset(id: string): Promise<Asset | null> {
  const s = await createClient();
  const { data } = await s.from("assets").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as Asset | null;
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
  return (data ?? []) as Courier[];
}
export async function getCourierOptions(): Promise<CourierOption[]> {
  const s = await createClient();
  const { data } = await s.from("couriers").select("id, code, name").eq("is_active", true).order("name");
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
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as CourierDespatch),
    courier_name: joined(r, "couriers", "name"),
  }));
}
