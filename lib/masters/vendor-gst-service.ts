import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GstRegStatus, VendorStatus, VendorType } from "./vendor-types";

// ============================================================================
// GST Assign to Vendors (Associates). A bulk-edit grid over the existing
// `master_vendors` master: list every vendor + its GST Type (gst_reg_status)
// and GSTIN (gst_no), plus read-only identity/category columns for filtering.
// No own table — this is a lean read + a two-column bulk update. Mirrors the
// TCS-assign pattern (lib/masters/tcs-service.ts). Replaces the legacy
// "GST No Assign to Vendor — By Party" 2-step wizard with one screen.
// ============================================================================

export interface VendorGstRow {
  id: string;
  code: string | null; // "Short Name" → legacy "Party"
  name: string; // legacy "Party Name"
  vendor_type: VendorType | null;
  status: VendorStatus;
  gst_reg_status: GstRegStatus | null;
  gst_no: string | null;
  // category flags (legacy "Category" grid)
  is_bought_items_vendor: boolean;
  is_processor: boolean;
  is_service_provider: boolean;
  is_sub_contractor: boolean;
}

export async function listVendorGst(): Promise<VendorGstRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("master_vendors")
    .select(
      "id, code, name, vendor_type, status, gst_reg_status, gst_no, is_bought_items_vendor, is_processor, is_service_provider, is_sub_contractor",
    )
    .order("name");
  return (data ?? []) as VendorGstRow[];
}
