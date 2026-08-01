import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Component } from "./component-types";

export async function listComponents(): Promise<Component[]> {
  const s = await createClient();
  const { data } = await s
    .from("components")
    .select("*, coordinates:component_coordinates(*)")
    .order("short_name", { nullsFirst: false });
  return withCreators(((data ?? []) as Component[]).map((c) => ({
    ...c,
    coordinates: [...(c.coordinates ?? [])].sort((x, y) => x.sno - y.sno),
  })));
}
