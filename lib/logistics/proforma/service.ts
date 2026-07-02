import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProformaInvoice, ProformaLine } from "./types";

export type ProformaWithBuyer = ProformaInvoice & {
  buyers: { id: string; name: string } | null;
};

export type BuyerOption = { id: string; name: string; code: string | null };
export type CurrencyOption = { code: string; name: string | null };

export async function getProformaInvoices(): Promise<ProformaWithBuyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("proforma_invoices")
    .select("*, buyers(id, name)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as ProformaWithBuyer[];
}

export async function getProformaInvoice(
  id: string,
): Promise<ProformaWithBuyer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("proforma_invoices")
    .select("*, buyers(id, name)")
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as ProformaWithBuyer | null;
}

export async function getProformaLines(
  proformaId: string,
): Promise<ProformaLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("proforma_invoice_lines")
    .select("*")
    .eq("proforma_id", proformaId)
    .order("sort_order");
  return (data ?? []) as ProformaLine[];
}

export async function getBuyerOptions(): Promise<BuyerOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as BuyerOption[];
}

export async function getCurrencyOptions(): Promise<CurrencyOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("currencies")
    .select("code, name")
    .order("code");
  return (data ?? []) as CurrencyOption[];
}
