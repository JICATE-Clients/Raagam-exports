import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { ConfigLookup, Transporter, GstRate, Attribute } from "./extras-types";
import { naturalSizeOrder } from "./size-order";

export async function listConfigLookups(): Promise<ConfigLookup[]> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("*")
    .order("kind")
    .order("name");
  /* SIZES IN SIZE ORDER, not alphabetical (2026-09-26 audit: the Sizes master
     read L, M, S, XL, XS). Every other kind keeps ORDER BY name; within
     kind='size' the app's one size rule (`naturalSizeOrder`) re-sorts. The
     kinds stay grouped, so a stable sort that only compares two sizes is
     enough. */
  const rows = ((data ?? []) as ConfigLookup[]).slice().sort((a, b) =>
    a.kind === "size" && b.kind === "size" ? naturalSizeOrder(a.name, b.name) : 0,
  );
  return withCreators(rows);
}

export async function listTransporters(): Promise<Transporter[]> {
  const s = await createClient();
  const { data } = await s.from("transporters").select("*").order("name");
  return withCreators((data ?? []) as Transporter[]);
}

export async function listGstRates(): Promise<GstRate[]> {
  const s = await createClient();
  const { data } = await s.from("gst_rates").select("*").order("rate_pct");
  return withCreators((data ?? []) as GstRate[]);
}

export async function listItemClasses(): Promise<ConfigLookup[]> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("*")
    .eq("kind", "item_class")
    .order("code");
  return withCreators((data ?? []) as ConfigLookup[]);
}

export async function listAttributes(): Promise<Attribute[]> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("*, values:attribute_values(*, options:attribute_value_options(*))")
    .eq("kind", "item_class")
    .order("code");
  return withCreators(((data ?? []) as Attribute[]).map((a) => ({
    ...a,
    values: [...(a.values ?? [])]
      .sort((x, y) => x.sno - y.sno)
      .map((v) => ({ ...v, options: [...(v.options ?? [])].sort((x, y) => x.sno - y.sno) })),
  })));
}
