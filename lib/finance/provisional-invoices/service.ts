import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProvisionalInvoice } from "./types";

export type ProvisionalInvoiceRow = ProvisionalInvoice & {
  buyers: { id: string; name: string } | null;
};

export async function getProvisionalInvoices(): Promise<ProvisionalInvoiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("provisional_invoices")
    .select("*, buyers(id, name)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as ProvisionalInvoiceRow[];
}

export {
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/finance/notes/service";
