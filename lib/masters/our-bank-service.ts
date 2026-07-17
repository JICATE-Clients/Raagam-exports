import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OurBank } from "./our-bank-types";

export async function listOurBanks(): Promise<OurBank[]> {
  const s = await createClient();
  const { data } = await s
    .from("our_banks")
    .select("*")
    .order("account_name", { nullsFirst: false });
  return (data ?? []) as OurBank[];
}
