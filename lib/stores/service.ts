import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Store, StockBalance, StockLedgerEntry, StoreAccessRow } from "./types";
import type { Item } from "@/lib/masters/types";

// ---------- enriched types ----------

export type StoreWithStats = Store & {
  item_count: number;
  total_qty: number;
};

export type BalanceWithItem = StockBalance & {
  item_code: string;
  item_name: string;
};

export type LedgerWithItem = StockLedgerEntry & {
  item_code: string;
  item_name: string;
};

export type AccessWithProfile = StoreAccessRow & {
  full_name: string | null;
  email: string | null;
};

// ---------- stores ----------

export async function listAccessibleStores(): Promise<StoreWithStats[]> {
  const supabase = await createClient();

  const { data: storesData } = await supabase
    .from("stores")
    .select("*")
    .order("code");

  const stores = (storesData ?? []) as Store[];
  if (stores.length === 0) return [];

  const storeIds = stores.map((s) => s.id);

  const { data: balancesData } = await supabase
    .from("stock_balances")
    .select("store_id, quantity")
    .in("store_id", storeIds);

  const balances = (balancesData ?? []) as { store_id: string; quantity: number }[];

  // Aggregate item count and total qty per store
  const statsMap: Record<string, { item_count: number; total_qty: number }> = {};
  for (const b of balances) {
    const s = (statsMap[b.store_id] ??= { item_count: 0, total_qty: 0 });
    s.item_count += 1;
    s.total_qty += b.quantity;
  }

  return stores.map((s) => ({
    ...s,
    item_count: statsMap[s.id]?.item_count ?? 0,
    total_qty: statsMap[s.id]?.total_qty ?? 0,
  }));
}

export async function getStore(storeId: string): Promise<Store | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .maybeSingle();
  return (data ?? null) as Store | null;
}

export async function getStoreBalances(storeId: string): Promise<BalanceWithItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_balances")
    .select("*, items(code, name)")
    .eq("store_id", storeId)
    .order("item_id");

  return (
    (data ?? []) as unknown as (StockBalance & {
      items: { code: string; name: string } | null;
    })[]
  ).map((row) => ({
    ...row,
    item_code: row.items?.code ?? "—",
    item_name: row.items?.name ?? "—",
  }));
}

export async function getStoreLedger(
  storeId: string,
  limit = 100,
): Promise<LedgerWithItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_ledger")
    .select("*, items(code, name)")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (
    (data ?? []) as unknown as (StockLedgerEntry & {
      items: { code: string; name: string } | null;
    })[]
  ).map((row) => ({
    ...row,
    item_code: row.items?.code ?? "—",
    item_name: row.items?.name ?? "—",
  }));
}

// ---------- lookups ----------

export async function getItems(): Promise<Pick<Item, "id" | "code" | "name">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Pick<Item, "id" | "code" | "name">[];
}

export async function getAccessibleStoresForTransfer(
  excludeId: string,
): Promise<Pick<Store, "id" | "code" | "name">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select("id, code, name")
    .eq("is_active", true)
    .neq("id", excludeId)
    .order("code");
  return (data ?? []) as Pick<Store, "id" | "code" | "name">[];
}

export async function getStoreAccess(storeId: string): Promise<AccessWithProfile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("store_access")
    .select("*, profiles(full_name, email)")
    .eq("store_id", storeId);

  return (
    (data ?? []) as unknown as (StoreAccessRow & {
      profiles: { full_name: string | null; email: string | null } | null;
    })[]
  ).map((row) => ({
    ...row,
    full_name: row.profiles?.full_name ?? null,
    email: row.profiles?.email ?? null,
  }));
}

export async function getProfiles(): Promise<
  { id: string; full_name: string | null; email: string | null }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name");
  return (data ?? []) as { id: string; full_name: string | null; email: string | null }[];
}
