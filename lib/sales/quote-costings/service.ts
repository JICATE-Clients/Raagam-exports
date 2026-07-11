import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCurrencies } from "@/lib/masters/service";
import type { Currency } from "@/lib/masters/types";
import type { QuoteCosting } from "./types";

/** A row normalized to {id, code, name} for a RecordPicker. */
export type PickerRow = { id: string; code: string | null; name: string };

/** An opportunity for the "Enquiry No" picker (+ currency for prefill). */
export type EnquiryRow = {
  id: string;
  code: string | null;
  name: string;
  currency_code: string | null;
};

/** All quote costings with embedded enquiry / customer / style. */
export async function getQuoteCostings(): Promise<QuoteCosting[]> {
  const s = await createClient();
  const { data } = await s
    .from("quote_costings")
    .select(
      "*, opportunity:opportunities(id,code), " +
        "customer:buyers(id,code,name), " +
        "style:garment_styles(id,code,style_name)",
    )
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as QuoteCosting[];
}

/** Opportunities for the "Enquiry No" picker (+ currency for prefill). */
async function getEnquiryRows(): Promise<EnquiryRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("opportunities")
    .select("id, code, title, buyer_id, currency_code, season, buyers(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as {
    id: string;
    code: string | null;
    title: string | null;
    currency_code: string | null;
    season: string | null;
    buyers?: { name: string } | null;
  }[]).map((o) => ({
    id: o.id,
    code: o.code,
    name: [o.buyers?.name, o.season, o.title].filter(Boolean).join(" · ") || "(enquiry)",
    currency_code: o.currency_code,
  }));
}

/** Buyers for the "Customer" picker. */
async function getBuyerRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("buyers")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as PickerRow[];
}

/** Garment styles for the "Style No" picker. */
async function getStyleRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_styles")
    .select("id, code, style_name")
    .order("created_at", { ascending: false });
  return ((data ?? []) as { id: string; code: string | null; style_name: string | null }[]).map(
    (r) => ({ id: r.id, code: r.code, name: r.style_name ?? "(unnamed style)" }),
  );
}

export type QuoteCostingFormData = {
  enquiries: EnquiryRow[];
  buyers: PickerRow[];
  styles: PickerRow[];
  currencies: Currency[];
};

/** Every picker option list the costing editor needs, fetched in parallel. */
export async function getQuoteCostingFormData(): Promise<QuoteCostingFormData> {
  const [enquiries, buyers, styles, currencies] = await Promise.all([
    getEnquiryRows(),
    getBuyerRows(),
    getStyleRows(),
    listCurrencies(),
  ]);
  return { enquiries, buyers, styles, currencies };
}
