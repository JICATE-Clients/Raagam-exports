import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { TaApproval } from "./ta-approval-types";

export async function listTaApprovals(): Promise<TaApproval[]> {
  const s = await createClient();
  const { data } = await s.from("ta_approvals").select("*").order("sequence");
  return withCreators((data ?? []) as TaApproval[]);
}
