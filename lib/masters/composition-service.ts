import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Composition } from "./composition-types";

export async function listCompositions(): Promise<Composition[]> {
  const s = await createClient();
  const { data } = await s
    .from("compositions")
    .select("*, lines:composition_lines(*)")
    .order("name", { nullsFirst: false });
  return ((data ?? []) as Composition[]).map((c) => ({
    ...c,
    lines: [...(c.lines ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
