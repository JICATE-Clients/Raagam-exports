import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getRequirementLines } from "@/lib/purchase/re-po/service";
import { getPoBudgetVariance } from "@/lib/purchase/po-escalation";
import { poBudgetImpact } from "@/lib/purchase/re-po/types";
import { fmtFixed } from "@/lib/format";

/**
 * A PURCHASE ORDER IN MY APPROVALS (user 2026-10-28, 0764): "display the line-item
 * variance and net profit impact directly in the approver's card".
 *
 * The figures are the PO page's own — `getPoBudgetVariance` for the budget rate per
 * line and `poBudgetImpact` for what the rates above it cost the order — so the card
 * and the page the MD can open from it cannot disagree.
 *
 * A FIXED NUMBER OF READS, WHATEVER THE QUEUE: the headers, their lines, the
 * requirement lines behind them, the budget rates. Like the budget cards, a failure
 * is an empty map — the inbox renders without any of this and the row still opens
 * the PO.
 */
export type PoApprovalCard = {
  poId: string;
  code: string | null;
  vendor: string | null;
  /** "₹ 1,23,456.00" / "USD 4,500.00" — the PO's own currency. */
  total: string;
  lineCount: number;
  /** null: the reader may not see budget figures (not a `materials_purchase:approve` holder). */
  overCount: number | null;
  unbudgetedCount: number | null;
  /** Rupees the rates above budget take off the order's profit (GST included). */
  profitHit: number | null;
  /** That, as a % of what the same lines were budgeted at. */
  overPct: number | null;
  /** The Purchase Manager's reason for the rate (0761). */
  reason: string | null;
};

type Header = {
  id: string;
  code: string | null;
  po_type: string | null;
  exchange_rate: number | string | null;
  gst_pct: number | string | null;
  total_amount: number | string | null;
  foreign_currency_code: string | null;
  budget_reason: string | null;
  master_vendor: { name: string | null } | { name: string | null }[] | null;
  vendors: { name: string | null } | { name: string | null }[] | null;
};
type Line = {
  id: string;
  purchase_order_id: string;
  item_id: string | null;
  uom_id: string | null;
  unit_price: number | string;
  quantity: number | string;
  gst_pct: number | string | null;
  req_key: string | null;
  garment_order_id: string | null;
  iwo_id: string | null;
};

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadPoApprovalCards(poIds: readonly string[]): Promise<Record<string, PoApprovalCard>> {
  if (!poIds.length) return {};
  const s = await createClient();
  const [heads, lineRes] = await Promise.all([
    s
      .from("purchase_orders")
      // Named FKs: purchase_orders → vendors is ambiguous (AGENTS.md, "A second FK").
      .select(
        "id, code, po_type, exchange_rate, gst_pct, total_amount, foreign_currency_code, budget_reason, " +
          "master_vendor:master_vendors!master_vendor_id(name), vendors!vendor_id(name)",
      )
      .in("id", [...poIds]),
    s
      .from("po_line_items")
      .select("id, purchase_order_id, item_id, uom_id, unit_price, quantity, gst_pct, req_key, garment_order_id, iwo_id")
      .in("purchase_order_id", [...poIds]),
  ]);
  if (heads.error) throw new Error(heads.error.message);
  if (lineRes.error) throw new Error(lineRes.error.message);
  const headers = (heads.data ?? []) as unknown as Header[];
  const lines = (lineRes.data ?? []) as unknown as Line[];

  const sourceIds = [...new Set(lines.map((l) => l.garment_order_id ?? l.iwo_id).filter((v): v is string => !!v))];
  const req = sourceIds.length ? await getRequirementLines(sourceIds) : [];
  // One read for every PO's lines; null when the reader may not see budget figures.
  const variance = await getPoBudgetVariance(lines, req);

  const out: Record<string, PoApprovalCard> = {};
  for (const h of headers) {
    const mine = lines.filter((l) => l.purchase_order_id === h.id);
    const isImport = h.po_type === "import";
    const fx = isImport ? Number(h.exchange_rate ?? 0) || 1 : 1;
    const impact = variance ? poBudgetImpact(mine, variance, { fx, defaultGstPct: Number(h.gst_pct ?? 0) }) : null;
    const cur = isImport ? (h.foreign_currency_code ?? "") : "₹";
    out[h.id] = {
      poId: h.id,
      code: h.code,
      vendor: one(h.master_vendor)?.name ?? one(h.vendors)?.name ?? null,
      total: `${cur} ${fmtFixed(Number(h.total_amount ?? 0), 2)}`,
      lineCount: mine.length,
      overCount: impact ? impact.over.length : null,
      unbudgetedCount: impact ? impact.unbudgeted.length : null,
      profitHit: impact ? impact.profitHit : null,
      overPct: impact ? impact.overPct : null,
      reason: h.budget_reason?.trim() || null,
    };
  }
  return out;
}
