import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LcDetail } from "./types";
import { withCreators } from "@/lib/created-by";

export type LcWithBuyer = LcDetail & {
  buyers: { id: string; name: string } | null;
};

export async function getLcDetails(): Promise<LcWithBuyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lc_details")
    .select("*, buyers(id, name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators((data ?? []) as unknown as LcWithBuyer[]);
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
