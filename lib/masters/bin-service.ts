import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Bin } from "./bin-types";

export async function listBins(): Promise<Bin[]> {
  const s = await createClient();
  const { data } = await s
    .from("bins")
    .select("*, location:locations(id,code,name)")
    .order("bin_code", { nullsFirst: false });
  return (data ?? []) as Bin[];
}
