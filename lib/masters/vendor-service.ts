import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Vendor } from "./vendor-types";

/** id · code · name for a Vendor picker — no child grids, no joins. */
export type VendorPickerRow = { id: string; code: string | null; name: string };

/**
 * Vendors for a picker on ANOTHER screen (Customer ▸ Nominated / Recommended).
 *
 * `public.master_vendors` — the Vendor master the operator maintains at Masters
 * ▸ Associates ▸ Vendor — NOT `public.vendors`, the older purchase-side table.
 * Both exist and both hold rows: the Customer screen used to call
 * `getVendorsForPicker()` (`lib/purchase/po-service.ts`), so the Nominated
 * Vendor dropdown listed seven purchase-side rows — four of them the
 * `decade00-…` demo seed — while every vendor created in the master was missing
 * from it (client, 2026-07-31). 0376 repointed
 * `customer_nominated_vendors.vendor_id` here to match.
 *
 * The purchase module's own vendor pickers still read `public.vendors`, and
 * correctly so: `purchase_orders`, `grns`, `rfqs` and 15 other transaction
 * tables FK there. Merging the two tables is a separate, much larger migration.
 *
 * Inactive vendors are filtered OUT rather than greyed: `RecordPicker` has no
 * disabled state, so a greyed row is not something it can express. A customer
 * already nominating a since-deactivated vendor keeps the row — the FK is
 * untouched — but the name resolves through the caller's own map.
 */
export async function listVendorsForPicker(): Promise<VendorPickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("master_vendors")
    .select("id, code, name")
    .eq("inactive", false)
    .order("name");
  return (data ?? []) as VendorPickerRow[];
}

export async function listVendors(): Promise<Vendor[]> {
  const s = await createClient();
  const { data } = await s
    .from("master_vendors")
    .select(
      // The four category-gated grids (0369 · 0370 · 0372) ride along with the
      // header: the list page already holds every vendor, so the editor opens
      // without a second round trip.
      "*, country:countries!master_vendors_country_id_fkey(id,code,name), addresses:master_vendor_addresses(*), item_categories:master_vendor_item_categories(*), processes:master_vendor_processes(*), services:master_vendor_services(*), subcontracts:master_vendor_subcontracts(*)",
    )
    .order("name");
  return ((data ?? []) as unknown as Vendor[]).map((v) => ({
    ...v,
    addresses: [...(v.addresses ?? [])].sort((a, b) => a.sno - b.sno),
    item_categories: [...(v.item_categories ?? [])].sort((a, b) => a.sno - b.sno),
    processes: [...(v.processes ?? [])].sort((a, b) => a.sno - b.sno),
    services: [...(v.services ?? [])].sort((a, b) => a.sno - b.sno),
    subcontracts: [...(v.subcontracts ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}
