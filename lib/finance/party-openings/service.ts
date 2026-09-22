import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PartyOpening } from "./types";
import { withCreators } from "@/lib/created-by";

export type PartyOpeningRow = PartyOpening & {
  vendors: { id: string; name: string } | null;
  buyers: { id: string; name: string } | null;
};

export async function getPartyOpenings(): Promise<PartyOpeningRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("party_openings")
    .select("*, vendors(id, name), buyers(id, name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators((data ?? []) as unknown as PartyOpeningRow[]);
}

export {
  getVendorOptions,
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/finance/notes/service";
