import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { QuoteCosting } from "@/lib/sales/quote-costings/types";

// ============================================================================
// Approve Costing (Planning ▸ Materials-Garment Orders ▸ "Approve Costing").
// The planner-side view over the Sales garment costing sheet (quote_costings,
// 0270): list finalised / approved / rejected costings so a planner can sign
// off before the costing feeds order budgeting. Cross-module read is granted by
// the supplementary quote_costings_planning_read RLS policy (0278).
// ============================================================================

export async function listCostingsForApproval(): Promise<QuoteCosting[]> {
  const s = await createClient();
  const { data } = await s
    .from("quote_costings")
    .select(
      "*, opportunity:opportunities(id,code), " +
        "customer:buyers(id,code,name), " +
        "style:garment_styles(id,code,style_name)",
    )
    .in("status", ["finalised", "approved", "rejected"])
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as QuoteCosting[];
}
