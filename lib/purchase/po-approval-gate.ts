import "server-only";
import { createClient } from "@/lib/supabase/server";
import { refuseReopenedBudget, refuseUnsettledMaterials } from "./bom-ceiling-service";

/**
 * MAY THIS PO BE APPROVED NOW? — the one answer, for both doors (0764).
 *
 * Approval is the moment a PO goes to the supplier, so it re-asks what submit
 * asked, against TODAY's state: a budget reopened since (Phase 5, decision 3), and
 * a material switched back to To be advised since (Advised Items, 2026-09-19).
 * `approvePo` on the PO page asked this before 0764; since then the MD can also
 * approve from My Approvals, where `actOnRun` asks it through
 * `lib/approvals/pre-approve.ts`. One function, so the inbox can never approve
 * what the PO page would have refused.
 *
 * NULL = may be approved; otherwise the sentence to show.
 */
export async function poApproveRefusal(poId: string): Promise<string | null> {
  const s = await createClient();
  const { data: lines } = await s
    .from("po_line_items")
    .select("item_id, sales_order_id, iwo_id")
    .eq("purchase_order_id", poId);
  const rows = (lines ?? []) as { item_id: string | null; sales_order_id: string | null; iwo_id: string | null }[];
  return (await refuseReopenedBudget(rows)) ?? (await refuseUnsettledMaterials(rows));
}
