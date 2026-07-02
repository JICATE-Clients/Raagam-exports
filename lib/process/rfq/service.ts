import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProcessRfq, ProcessRfqQuote } from "./types";

export type ProcessRfqRow = ProcessRfq & {
  sales_orders: { id: string; order_number: string | null } | null;
};

export type ProcessRfqDetail = ProcessRfq & {
  sales_orders: { id: string; order_number: string | null } | null;
  vendors: { id: string; name: string } | null;
};

export type QuoteRow = ProcessRfqQuote & {
  vendors: { id: string; name: string } | null;
};

export type VendorOption = { id: string; name: string };
export type OrderOption = { id: string; order_number: string | null };

export async function getProcessRfqs(): Promise<ProcessRfqRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("process_rfqs")
    .select("*, sales_orders(id, order_number)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as ProcessRfqRow[];
}

export async function getProcessRfq(id: string): Promise<ProcessRfqDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("process_rfqs")
    .select("*, sales_orders(id, order_number), vendors:confirmed_vendor_id(id, name)")
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as ProcessRfqDetail | null;
}

export async function getProcessRfqQuotes(rfqId: string): Promise<QuoteRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("process_rfq_quotes")
    .select("*, vendors(id, name)")
    .eq("rfq_id", rfqId)
    .order("rate");
  return (data ?? []) as unknown as QuoteRow[];
}

export async function getVendorOptions(): Promise<VendorOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("vendors").select("id, name").order("name");
  return (data ?? []) as VendorOption[];
}

export async function getOrderOptions(): Promise<OrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number")
    .order("created_at", { ascending: false });
  return (data ?? []) as OrderOption[];
}
