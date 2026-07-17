import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StockUnit } from "./stock-unit-types";

export async function listStockUnits(): Promise<StockUnit[]> {
  const s = await createClient();
  const { data } = await s.from("uoms").select("*").order("name");
  return ((data ?? []) as StockUnit[]).map((u) => ({
    ...u,
    item_classes: u.item_classes ?? [],
    decimal_places_allowed: u.decimal_places_allowed ?? 2,
    unit_code: u.unit_code ?? null,
    is_fabric: u.is_fabric ?? false,
    is_yarn: u.is_yarn ?? false,
    is_sewing: u.is_sewing ?? false,
    is_packing: u.is_packing ?? false,
    is_general: u.is_general ?? false,
    is_garment: u.is_garment ?? false,
  }));
}
