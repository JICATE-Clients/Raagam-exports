import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LcDetail } from "./types";

export type LcWithBuyer = LcDetail & {
  buyers: { id: string; name: string } | null;
};

export async function getLcDetails(): Promise<LcWithBuyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lc_details")
    .select("*, buyers(id, name)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as LcWithBuyer[];
}

export async function getLcDetail(id: string): Promise<LcWithBuyer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lc_details")
    .select("*, buyers(id, name)")
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as LcWithBuyer | null;
}

// Buyer + currency option loaders are shared with the proforma slice.
export {
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/logistics/proforma/service";
