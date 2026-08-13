import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BomCeiling } from "./bom-ceiling";

/**
 * The lookup half of the over-quantity ceiling (0424). The rule it feeds — and
 * the four things it has to get right — is documented on `BomCeiling` in
 * `./bom-ceiling`, which is client-safe because the verdict is read as the
 * operator types.
 */
const EMPTY: BomCeiling = { byItem: new Map(), bomId: null, bomCode: null, unanswered: 0 };

export async function bomCeilingForOrder(salesOrderId: string): Promise<BomCeiling> {
  const s = await createClient();

  // sales_orders -> the garment order documents raised against it. More than one
  // is possible (the document is amendable), so every one is a candidate and the
  // newest BOM across them wins below.
  const { data: goRows } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("sales_order_id", salesOrderId);

  const goIds = ((goRows ?? []) as { id: string }[]).map((r) => r.id);
  if (goIds.length === 0) return EMPTY;

  const { data: bomRows } = await s
    .from("material_bom_amendments")
    .select("id, code, amendment_no, is_draft, garment_order_id")
    .in("garment_order_id", goIds)
    .eq("is_draft", false)
    .order("amendment_no", { ascending: false })
    .limit(1);

  const bom = ((bomRows ?? []) as { id: string; code: string | null }[])[0];
  if (!bom) return EMPTY;

  const { data: reqRows } = await s
    .from("material_bom_amendment_requirements")
    .select("item_id, required_qty, purchase_qty, refusal_reason")
    .eq("amendment_id", bom.id);

  const byItem = new Map<string, number>();
  let unanswered = 0;

  for (const r of (reqRows ?? []) as {
    item_id: string | null;
    required_qty: number | null;
    purchase_qty: number | null;
    refusal_reason: string | null;
  }[]) {
    if (r.refusal_reason !== null || r.required_qty === null) {
      unanswered += 1;
      continue;
    }
    if (!r.item_id) continue;
    const qty = r.purchase_qty ?? r.required_qty;
    byItem.set(r.item_id, (byItem.get(r.item_id) ?? 0) + Number(qty));
  }

  return { byItem, bomId: bom.id, bomCode: bom.code, unanswered };
}
