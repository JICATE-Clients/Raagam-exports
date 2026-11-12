import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentLocationId } from "@/lib/auth/location";
import type { DashBin, DashStore } from "@/components/purchase/inventory/store-icons";

/**
 * The working unit's stores and every bin in them (RLS scopes both to the units this login
 * holds). Shared by Purchase ▸ Purchase Store ▸ Overview and Stores ▸ Overview (2026-11-06) —
 * moved out of the Store Overview page, since a page file can export nothing but the page.
 */
export async function unitStoresAndBins(): Promise<{ stores: DashStore[]; bins: DashBin[] }> {
  const loc = await getCurrentLocationId();
  if (!loc) return { stores: [], bins: [] };
  const s = await createClient();
  const { data: stores, error } = await s.from("stores").select("id, name, store_type").eq("location_id", loc).order("name");
  if (error) throw new Error(`Stores: ${error.message}`);
  const ids = ((stores ?? []) as DashStore[]).map((x) => x.id);
  if (!ids.length) return { stores: [], bins: [] };
  const { data: bins, error: bErr } = await s.from("bins").select("id, bin_code, store_id, inactive, description").in("store_id", ids).order("bin_code");
  if (bErr) throw new Error(`Bins: ${bErr.message}`);
  return {
    stores: (stores ?? []) as DashStore[],
    bins: ((bins ?? []) as (DashBin & { inactive: boolean | null })[]).map((b) => ({ ...b, inactive: !!b.inactive })),
  };
}
