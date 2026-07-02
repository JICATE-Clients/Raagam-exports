import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ConfigLookup, Transporter, GstRate } from "./extras-types";

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
