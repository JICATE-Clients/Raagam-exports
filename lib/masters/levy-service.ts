import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Levy } from "./levy-types";

/**
 * This used to embed the creator — `.select("*, creator:profiles!created_by(
 * full_name)")` — which silently returned null for anyone but the record's own
 * author: `profiles_read_own` (0001_foundation.sql:150) hides other users'
 * profile rows from a non-admin. `withCreators` resolves the names through the
 * SECURITY DEFINER `creator_names()` RPC instead (0383).
 */
export async function listLevies(): Promise<Levy[]> {
  const s = await createClient();
  const { data } = await s.from("levies").select("*").order("entry_no");
  return withCreators((data ?? []) as Levy[]);
}
