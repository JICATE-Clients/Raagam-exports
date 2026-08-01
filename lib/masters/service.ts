import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Buyer, Item, Uom, Currency } from "@/lib/masters/types";

export async function listBuyers(): Promise<Buyer[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("buyers").select("*").order("name");
  return (data ?? []) as Buyer[];
}

/**
 * id · code · name for a Customer picker — no children, no joins.
 *
 * Sibling of `listVendorsForPicker`, and inactive rows travel for the same
 * reason: a buyer already linked to a since-deactivated customer must still
 * resolve to a name instead of showing an empty field (AGENTS.md, "Disabled
 * rows"). `listCustomers()` pulls six child grids and is far too heavy for a
 * single link field.
 */
export async function listCustomersForPicker(): Promise<
  { id: string; code: string | null; name: string; inactive: boolean }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, code, name, inactive")
    .order("name");
  return (data ?? []) as { id: string; code: string | null; name: string; inactive: boolean }[];
}

export async function listItems(): Promise<Item[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("items").select("*").order("name");
  return (data ?? []) as Item[];
}

export async function listUoms(): Promise<Uom[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("uoms").select("*").order("name");
  return (data ?? []) as Uom[];
}

export async function listCurrencies(): Promise<Currency[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("currencies").select("*").order("name");
  return (data ?? []) as Currency[];
}
