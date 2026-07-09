import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StockUnit } from "./stock-unit-types";

export async function listStockUnits(): Promise<StockUnit[]> {
  const s = await createClient();
  const { data } = await s.from("uoms").select("*").order("name");
  return ((data ?? []) as StockUnit[]).map((u) => ({
    ...u,
    item_classes: u.item_classes ?? [],
  }));
}
