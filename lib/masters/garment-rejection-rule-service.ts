import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { GarmentRejectionRule } from "./garment-rejection-rule-types";

export async function listGarmentRejectionRules(): Promise<GarmentRejectionRule[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_rejection_rules")
    .select("*, lines:garment_rejection_rule_lines(*)")
    .order("entry_no");
  return withCreators(((data ?? []) as GarmentRejectionRule[]).map((r) => ({
    ...r,
    lines: [...(r.lines ?? [])].sort((x, y) => x.sno - y.sno),
  })));
}
