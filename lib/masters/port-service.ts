import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Port } from "./port-types";

export async function listPorts(): Promise<Port[]> {
  const s = await createClient();
  const { data } = await s
    .from("ports")
    .select("*, country:countries(id,code,name)")
    .order("name", { nullsFirst: false });
  return (data ?? []) as Port[];
}
