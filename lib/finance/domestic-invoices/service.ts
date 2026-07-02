import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DomesticInvoice } from "./types";

export type DomesticInvoiceRow = DomesticInvoice & {
  buyers: { id: string; name: string } | null;
};

export async function getDomesticInvoices(): Promise<DomesticInvoiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("domestic_garment_invoices")
    .select("*, buyers(id, name)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as DomesticInvoiceRow[];
}

export { getBuyerOptions } from "@/lib/finance/notes/service";
