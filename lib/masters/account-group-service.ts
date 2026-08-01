import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { AccountGroup } from "./account-group-types";

export async function listAccountGroups(): Promise<AccountGroup[]> {
  const s = await createClient();
  const { data } = await s.from("account_groups").select("*").order("name");
  return withCreators((data ?? []) as AccountGroup[]);
}
