import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProvisionalInvoice } from "./types";
import { withCreators } from "@/lib/created-by";

export type ProvisionalInvoiceRow = ProvisionalInvoice & {
  buyers: { id: string; name: string } | null;
};

export async function getProvisionalInvoices(): Promise<ProvisionalInvoiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("provisional_invoices")
    .select("*, buyers(id, name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators((data ?? []) as unknown as ProvisionalInvoiceRow[]);
}

export {
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/finance/notes/service";
