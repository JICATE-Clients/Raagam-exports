import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { AccountHead } from "./account-head-types";

export async function listAccountHeads(): Promise<AccountHead[]> {
  const s = await createClient();
  const { data } = await s.from("account_heads").select("*").order("name");
  return withCreators((data ?? []) as AccountHead[]);
}
