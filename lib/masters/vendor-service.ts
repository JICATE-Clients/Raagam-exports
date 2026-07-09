import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Vendor } from "./vendor-types";

export async function listVendors(): Promise<Vendor[]> {
  const s = await createClient();
  const { data } = await s
    .from("master_vendors")
    .select(
      "*, country:countries!master_vendors_country_id_fkey(id,code,name), addresses:master_vendor_addresses(*)",
    )
    .order("name");
  return ((data ?? []) as unknown as Vendor[]).map((v) => ({
    ...v,
    addresses: [...(v.addresses ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}
