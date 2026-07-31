import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Vendor } from "./vendor-types";

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
