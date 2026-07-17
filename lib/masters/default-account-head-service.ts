import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DefaultAccountHead } from "./default-account-head-types";

export async function getDefaultAccountHead(): Promise<DefaultAccountHead | null> {
  const s = await createClient();
  const { data } = await s
    .from("default_account_heads")
    .select("*")
    .limit(1)
    .maybeSingle();
  return (data as DefaultAccountHead | null) ?? null;
}
