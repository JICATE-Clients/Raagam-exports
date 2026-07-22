import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GarmentAcceptedQtyLevel } from "./garment-accepted-qty-level-types";

export async function listGarmentAcceptedQtyLevels(): Promise<GarmentAcceptedQtyLevel[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_accepted_qty_levels")
    .select("*, details:garment_accepted_qty_level_details(*)")
    .order("effective_from", { ascending: false });
  return (data ?? []) as GarmentAcceptedQtyLevel[];
}
