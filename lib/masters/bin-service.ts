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

export type BinStock = { qty: number; items: number };

/**
 * WHAT EACH BIN HOLDS NOW, for the Bins rack (2026-11-04): net quantity and how many
 * items, from `stock_bin_balances` (the ledger summed per store · bin · item, issues
 * negative). Only bins with something left appear. A failed read is an empty map — the
 * rack then draws every bin as empty, which only loses the shading, never a bin.
 */
export async function listBinStock(): Promise<Record<string, BinStock>> {
  const s = await createClient();
  const locationId = await getCurrentLocationId();
  if (!locationId) return {};
  const { data, error } = await s
    .from("stock_bin_balances")
    .select("bin_id, item_id, quantity")
    .eq("location_id", locationId)
    .not("bin_id", "is", null)
    .gt("quantity", 0);
  if (error) return {};
  const out: Record<string, BinStock> = {};
  for (const r of (data ?? []) as { bin_id: string; quantity: number }[]) {
    const cur = (out[r.bin_id] ??= { qty: 0, items: 0 });
    cur.qty += Number(r.quantity);
    cur.items += 1;
  }
  return out;
}
