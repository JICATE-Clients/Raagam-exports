import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AccountGroup } from "./account-group-types";

export async function listAccountGroups(): Promise<AccountGroup[]> {
  const s = await createClient();
  const { data } = await s.from("account_groups").select("*").order("name");
  return (data ?? []) as AccountGroup[];
}
