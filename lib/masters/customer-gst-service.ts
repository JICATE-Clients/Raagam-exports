import "server-only";
import { createClient } from "@/lib/supabase/server";

// ============================================================================
// GST Assign to Customers (Associates). A bulk-edit grid over the existing
// `customers` master: list every customer + its GSTIN (gst_no), plus read-only
// identity / city / status columns for filtering. No own table — a lean read +
// a one-column bulk update. Mirrors the TCS-assign + vendor GST-assign patterns.
// Replaces the legacy "GST No Assign to Customer — By Party" 2-step wizard.
//
// NOTE: customers carry a GST *number* only (no gst_reg_status / GST type) —
// matching the legacy screen, which has no "GST Type" filter. So this assigns
// gst_no alone; no migration.
// ============================================================================

export interface CustomerGstRow {
  id: string;
  code: string | null; // "Short Name" → legacy "Party"
  name: string; // legacy "Party Name"
  blocked: boolean;
  is_draft: boolean;
  city_id: string | null; // legacy center "City" grid (config_lookups 'city')
  gst_no: string | null;
}

export async function listCustomerGst(): Promise<CustomerGstRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("customers")
    .select("id, code, name, blocked, is_draft, city_id, gst_no")
    .order("name");
  return (data ?? []) as CustomerGstRow[];
}
