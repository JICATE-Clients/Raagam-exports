import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ConfigLookup, Transporter, GstRate, Attribute } from "./extras-types";

export async function listConfigLookups(): Promise<ConfigLookup[]> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("*")
    .order("kind")
    .order("name");
  return (data ?? []) as ConfigLookup[];
}

export async function listTransporters(): Promise<Transporter[]> {
  const s = await createClient();
  const { data } = await s.from("transporters").select("*").order("name");
  return (data ?? []) as Transporter[];
}

export async function listGstRates(): Promise<GstRate[]> {
  const s = await createClient();
  const { data } = await s.from("gst_rates").select("*").order("rate_pct");
  return (data ?? []) as GstRate[];
}

export async function listItemClasses(): Promise<ConfigLookup[]> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("*")
    .eq("kind", "item_class")
    .order("code");
  return (data ?? []) as ConfigLookup[];
}

export async function listAttributes(): Promise<Attribute[]> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("*, values:attribute_values(*, options:attribute_value_options(*))")
    .eq("kind", "item_class")
    .order("code");
  return ((data ?? []) as Attribute[]).map((a) => ({
    ...a,
    values: [...(a.values ?? [])]
      .sort((x, y) => x.sno - y.sno)
      .map((v) => ({ ...v, options: [...(v.options ?? [])].sort((x, y) => x.sno - y.sno) })),
  }));
}
