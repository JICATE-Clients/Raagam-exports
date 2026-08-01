import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Bin } from "./bin-types";

export async function listBins(): Promise<Bin[]> {
  const s = await createClient();
  const { data } = await s
    .from("bins")
    .select("*, location:locations(id,code,name)")
    .order("bin_code", { nullsFirst: false });
  return withCreators((data ?? []) as Bin[]);
}
