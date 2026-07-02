import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PartyOpening } from "./types";

export type PartyOpeningRow = PartyOpening & {
  vendors: { id: string; name: string } | null;
  buyers: { id: string; name: string } | null;
};

export async function getPartyOpenings(): Promise<PartyOpeningRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("party_openings")
    .select("*, vendors(id, name), buyers(id, name)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as PartyOpeningRow[];
}

export {
  getVendorOptions,
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/finance/notes/service";
