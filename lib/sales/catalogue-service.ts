import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StyleCatalogue, StylePriceList, PiEnquiry } from "./catalogue-types";

export async function listCatalogues(): Promise<StyleCatalogue[]> {
  const s = await createClient();
  const { data } = await s.from("style_catalogues").select("*").order("created_at", { ascending: false });
  return (data ?? []) as StyleCatalogue[];
}

export async function listPriceLists(): Promise<StylePriceList[]> {
  const s = await createClient();
  const { data } = await s.from("style_price_lists").select("*").order("created_at", { ascending: false });
  return (data ?? []) as StylePriceList[];
}

export type PiEnquiryRow = PiEnquiry & { buyer_name: string | null };

export async function listPiEnquiries(): Promise<PiEnquiryRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("pi_enquiries")
    .select("*, buyers:customer_id(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      buyer_name: (row.buyers as { name: string } | null)?.name ?? null,
    } as unknown as PiEnquiryRow;
  });
}
