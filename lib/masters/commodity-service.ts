import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Commodity } from "./commodity-types";

export async function listCommodities(): Promise<Commodity[]> {
  const s = await createClient();
  const { data } = await s
    .from("commodities")
    .select("*")
    .order("name", { nullsFirst: false });
  return (data ?? []) as Commodity[];
}
