import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tyre } from "./tyre-types";

export async function listTyres(): Promise<Tyre[]> {
  const s = await createClient();
  const { data } = await s
    .from("tyres")
    .select("*")
    .order("code", { nullsFirst: false });
  return (data ?? []) as Tyre[];
}
