import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Buyer, Item, Uom, Currency } from "@/lib/masters/types";

export async function listBuyers(): Promise<Buyer[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("buyers").select("*").order("name");
  return (data ?? []) as Buyer[];
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
