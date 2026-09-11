import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { TaApproval } from "./ta-approval-types";

export async function listTaApprovals(): Promise<TaApproval[]> {
  const s = await createClient();
  // Sequence is no longer an editable field (2026-09-11 spec) — every new row
  // defaults to 0, so ordering by it would bunch new approvals arbitrarily.
  // List alphabetically by name instead.
  const { data } = await s.from("ta_approvals").select("*").order("name");
  return withCreators((data ?? []) as TaApproval[]);
}
