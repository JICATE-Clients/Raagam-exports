import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocationId } from "@/lib/auth/location";
import type { Bin } from "./bin-types";

/** The current unit's bins (0800): a bin belongs to a store, a store to a unit. */
export async function listBins(): Promise<Bin[]> {
  const s = await createClient();
  const locationId = await getCurrentLocationId();
  if (!locationId) return [];
  const { data } = await s
    .from("bins")
    .select("*, location:locations(id,code,name), store:stores(id,code,name)")
    .eq("location_id", locationId)
    .order("bin_code", { nullsFirst: false });
  return withCreators((data ?? []) as Bin[]);
}
