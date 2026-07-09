import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AccountHead } from "./account-head-types";

export async function listAccountHeads(): Promise<AccountHead[]> {
  const s = await createClient();
  const { data } = await s.from("account_heads").select("*").order("name");
  return (data ?? []) as AccountHead[];
}
