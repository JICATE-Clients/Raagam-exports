import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";

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
  created_at: string;
  /** Both halves of the Created pair, or the User column is a row of dashes:
   *  `withCreators()` resolves the uuid, and a hand-written select has to FETCH
   *  it first. See components/ui/created-columns.tsx. */
  created_by: string | null;
}

export async function listCustomerTcs(): Promise<CustomerTcsRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("customers")
    .select("id, code, name, doc_id, country_id, tcs_applicable, created_at, created_by")
    .order("name");
  return withCreators((data ?? []) as CustomerTcsRow[]);
}
