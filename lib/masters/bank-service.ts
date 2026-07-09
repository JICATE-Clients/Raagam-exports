import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Bank } from "./bank-types";

export async function listBanks(): Promise<Bank[]> {
  const s = await createClient();
  const { data } = await s
    .from("banks")
    .select("*, branches:bank_branches(*)")
    .order("name");
  return ((data ?? []) as Bank[]).map((b) => ({
    ...b,
    branches: [...(b.branches ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
