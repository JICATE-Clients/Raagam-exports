import "server-only";
import { createClient } from "@/lib/supabase/server";
import { styleKey } from "@/lib/orders/amendments/style-key";
import { cadSheetLabel, type CadState } from "@/lib/orders/cad-lifecycle/types";
import { isRefusal, type GosSheet, type Refusal } from "./types";

/**
 * THE GARMENT ORDER SHEET'S CAD LINE, LIVE (doc/order/cad.md §6.2, 0628).
 *
 * Laid over the sheet at the page — a fresh one or a frozen V_final one — so
 * "Pending" turns into "Approved (V2)" the moment the buyer's decision is
 * recorded, even while the order is amending. CAD is not what an amendment
 * approves, so it is never frozen with the sheet (the same reason the style
 * pictures and the letterhead are read live beside it).
 *
 * The CURRENT document is resolved by the rule `getReportStyleImages` uses
 * (newest by amend date, then created_at), and its styles are read through
 * 0628's `cad_style_states` — the function the Fabric BOM guard reads — in ONE
 * call per sheet. A failed read leaves `cad` null (the dash), never a guessed
 * "Pending".
 */
export async function withCadStatus<T extends GosSheet | Refusal>(sheet: T, salesOrderId: string): Promise<T> {
  if (isRefusal(sheet)) return sheet;
  const s = await createClient();
  const { data: seq, error: seqErr } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("sales_order_id", salesOrderId)
    .order("amend_date", { ascending: true })
    .order("created_at", { ascending: true });
  const ids = ((seq ?? []) as { id: string }[]).map((r) => r.id);
  if (seqErr || ids.length === 0) {
    if (seqErr) console.error("[gos-cad] reading the order's documents:", seqErr.message);
    return { ...sheet, styles: sheet.styles.map((st) => ({ ...st, cad: null })) };
  }
  const { data, error } = await s.rpc("cad_style_states", { p_order: ids[ids.length - 1] });
  if (error) {
    console.error("[gos-cad] reading cad_style_states:", error.message);
    return { ...sheet, styles: sheet.styles.map((st) => ({ ...st, cad: null })) };
  }
  const byStyle = new Map(
    ((data ?? []) as { style_ref_no: string; version_no: number | null; state: CadState }[]).map((r) => [
      styleKey(r.style_ref_no),
      cadSheetLabel(r.state, r.version_no),
    ]),
  );
  return {
    ...sheet,
    styles: sheet.styles.map((st) => ({
      ...st,
      // A style the CAD function does not list (no ref) has no CAD yet: Pending.
      cad: byStyle.get(styleKey(st.styleRef)) ?? cadSheetLabel("not_allocated", null),
    })),
  };
}
