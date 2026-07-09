import "server-only";
import { createClient } from "@/lib/supabase/server";

// ============================================================================
// TCS Assign to Customers (Associates). A bulk-toggle grid over the existing
// `customers` master: list every customer + its `tcs_applicable` flag (0247).
// No own table — this is a lightweight read + a one-column update.
// ============================================================================

export interface CustomerTcsRow {
  id: string;
  code: string | null; // "Short Name"
  name: string;
  doc_id: string | null; // "Customer ID"
  country_id: string | null;
  tcs_applicable: boolean;
}

export async function listCustomerTcs(): Promise<CustomerTcsRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("customers")
    .select("id, code, name, doc_id, country_id, tcs_applicable")
    .order("name");
  return (data ?? []) as CustomerTcsRow[];
}
