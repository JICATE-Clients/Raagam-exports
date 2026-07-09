import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PaymentTerm } from "./payment-term-types";

export async function listPaymentTerms(): Promise<PaymentTerm[]> {
  const s = await createClient();
  const { data } = await s.from("payment_terms").select("*").order("entry_no");
  return (data ?? []) as PaymentTerm[];
}
