import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { StoreRow } from "./store-master-types";

/** The current unit's stores (the table's read policy narrows to it), system types first. */
export async function listStoresForMaster(): Promise<StoreRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("stores")
    .select("id, code, name, store_type, location_id, bin_prefix, is_active, created_at, created_by")
    .order("created_at");
  if (error) throw new Error(`Could not read the stores: ${error.message}`);
  return withCreators((data ?? []) as StoreRow[]);
}
