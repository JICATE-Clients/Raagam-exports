import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ReceivableTerm } from "./receivable-term-types";

export async function listReceivableTerms(): Promise<ReceivableTerm[]> {
  const s = await createClient();
  const { data } = await s.from("receivable_terms").select("*").order("entry_no");
  return (data ?? []) as ReceivableTerm[];
}
