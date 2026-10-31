import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getRequirementLines } from "@/lib/purchase/re-po/service";
import { getPoBudgetVariance } from "@/lib/purchase/po-escalation";
import { budgetRateOf, poBudgetImpact } from "@/lib/purchase/re-po/types";
import { fmtFixed } from "@/lib/format";

/** One line above its budget, GST-inclusive both sides, in rupees (`poBudgetImpact`). */
export type PoOverLine = { item: string; rate: number; budget: number };

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
  /** The lines above budget, each with its typed rate (incl. GST) and the ceiling. null = not visible. */
  overLines: PoOverLine[] | null;
  /** Sum of the lines' amounts before GST — the PO print's "taxable". */
  taxable: string;
  /** GST in the PO's currency; split in halves on an intra-state PO. */
  gst: string;
  gstSplit: { label: string; amount: string }[];
  /** The PO's expected date, else the latest line delivery date. ISO; format with fmtDate. */
  deliveryDate: string | null;
};

type Header = {
  id: string;
  code: string | null;
  po_type: string | null;
  exchange_rate: number | string | null;
  gst_pct: number | string | null;
  total_amount: number | string | null;
  gst_kind: string | null;
  expected_date: string | null;
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
  amount: number | string | null;
  gst_amount: number | string | null;
  description: string | null;
  delivery_date: string | null;
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
        "id, code, po_type, exchange_rate, gst_pct, total_amount, gst_kind, expected_date, foreign_currency_code, budget_reason, " +
          "master_vendor:master_vendors!master_vendor_id(name), vendors!vendor_id(name)",
      )
      .in("id", [...poIds]),
    s
      .from("po_line_items")
      .select(
        "id, purchase_order_id, item_id, uom_id, unit_price, quantity, gst_pct, amount, gst_amount, description, delivery_date, " +
          "req_key, garment_order_id, iwo_id",
      )
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
    const money = (v: number) => `${cur} ${fmtFixed(v, 2)}`;
    /* TAX THE WAY THE PO PRINT COUNTS IT (lib/purchase/po-print.ts): taxable is the sum
       of line amounts; a line's GST is its own `gst_amount`, or its amount at the slab
       for a line saved before lines carried one (0756). */
    const defaultPct = Number(h.gst_pct ?? 0);
    const taxable = mine.reduce((a, l) => a + Number(l.amount ?? 0), 0);
    const gst = mine.reduce(
      (a, l) =>
        a +
        (l.gst_amount == null
          ? (Number(l.amount ?? 0) * Number(l.gst_pct ?? defaultPct)) / 100
          : Number(l.gst_amount)),
      0,
    );
    const igst = h.gst_kind === "igst";
    const gstSplit = gst > 0
      ? igst
        ? [{ label: "IGST", amount: money(gst) }]
        : [
            { label: "CGST", amount: money(gst / 2) },
            { label: "SGST", amount: money(gst / 2) },
          ]
      : [];
    const lineDates = mine.map((l) => l.delivery_date).filter((d): d is string => !!d).sort();
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
      overLines: impact
        ? impact.over.map((l) => ({
            item: l.description?.trim() || "Item",
            rate: impact.netRateOf(l) * fx,
            budget: impact.budgetOf(l)!,
          }))
        : null,
      taxable: money(taxable),
      gst: money(gst),
      gstSplit,
      deliveryDate: h.expected_date ?? lineDates[lineDates.length - 1] ?? null,
    };
  }
  return out;
}

/* ───────────────────────────────────────────────────────────────────────────
 * A PO RATE AMENDMENT OR A PO CANCELLATION IN MY APPROVALS (0785).
 *
 * Read from the run's FROZEN `context` (what was sent, and what the MD's alert
 * said), keyed by subject id. A rate amendment's budget impact is the PO card's
 * own arithmetic — `getPoBudgetVariance` on the live line, `poBudgetImpact` with
 * the REVISED rate put in place of the line's — because the line still carries
 * the old rate until the final approve writes it. Same contract as above: a
 * failure is an empty map and the row still links to its screen.
 * ─────────────────────────────────────────────────────────────────────────── */

export type PoRateChangeCard = {
  kind: "rate";
  code: string | null;
  poCode: string | null;
  item: string | null;
  quantity: number;
  currency: string;
  previousRate: number;
  revisedRate: number;
  gstPct: number;
  /** Rates with GST added — what the budget is compared AS. */
  previousRateGst: number;
  revisedRateGst: number;
  /** revised_value − previous_value (qty × rate × (1 + GST)). */
  valueChange: number;
  reason: string | null;
  hasBudget: boolean;
  /** Budget ceiling per unit incl. GST, in rupees; null = no approved budget or not visible. */
  budgetRate: number | null;
  /** Rupees per unit above it (0 when within). */
  overPerUnit: number | null;
  /** Rupees the revised rate takes off the order's profit; 0 within budget. */
  profitHit: number | null;
};

export type PoCancelCard = {
  kind: "cancel";
  code: string | null;
  poCode: string | null;
  scope: "whole" | "partial";
  currency: string;
  cancelValue: number;
  reason: string | null;
  lines: {
    item: string | null;
    uom: string | null;
    orderedQty: number;
    receivedQty: number;
    openQty: number;
    cancelQty: number;
  }[];
};

export type PoChangeCard = PoRateChangeCard | PoCancelCard;

type Ctx = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function loadPoChangeCards(
  rows: readonly { run_id: string; workflow_key: string; subject_id: string }[],
): Promise<Record<string, PoChangeCard>> {
  const mine = rows.filter((r) => r.workflow_key === "po_rate_amendment" || r.workflow_key === "po_cancellation");
  if (!mine.length) return {};
  const s = await createClient();
  const { data: runs, error } = await s
    .from("approval_runs")
    .select("id, workflow_key, subject_id, context")
    .in("id", mine.map((r) => r.run_id));
  if (error) throw new Error(error.message);
  const all = (runs ?? []) as { id: string; workflow_key: string; subject_id: string; context: Ctx | null }[];

  // ── the rate amendments' budget, in a fixed number of reads ──
  const rateRuns = all.filter((r) => r.workflow_key === "po_rate_amendment");
  const lineIds = [...new Set(rateRuns.map((r) => str(r.context?.po_line_item_id)).filter((v): v is string => !!v))];
  let lines: Line[] = [];
  let fxByPo = new Map<string, { fx: number; gst: number }>();
  let variance: Record<string, number | null> | null = null;
  if (lineIds.length) {
    const { data: l, error: le } = await s
      .from("po_line_items")
      .select("id, purchase_order_id, item_id, uom_id, unit_price, quantity, gst_pct, amount, gst_amount, description, delivery_date, req_key, garment_order_id, iwo_id")
      .in("id", lineIds);
    if (le) throw new Error(le.message);
    lines = (l ?? []) as unknown as Line[];
    const poIds = [...new Set(lines.map((x) => x.purchase_order_id))];
    const { data: h, error: he } = poIds.length
      ? await s.from("purchase_orders").select("id, po_type, exchange_rate, gst_pct").in("id", poIds)
      : { data: [], error: null };
    if (he) throw new Error(he.message);
    fxByPo = new Map(
      ((h ?? []) as { id: string; po_type: string | null; exchange_rate: number | string | null; gst_pct: number | string | null }[]).map((x) => [
        x.id,
        { fx: x.po_type === "import" ? Number(x.exchange_rate ?? 0) || 1 : 1, gst: Number(x.gst_pct ?? 0) },
      ]),
    );
    const sourceIds = [...new Set(lines.map((x) => x.garment_order_id ?? x.iwo_id).filter((v): v is string => !!v))];
    const req = sourceIds.length ? await getRequirementLines(sourceIds) : [];
    variance = await getPoBudgetVariance(lines, req);
  }
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const out: Record<string, PoChangeCard> = {};
  for (const r of all) {
    const c = r.context ?? {};
    const currency = str(c.currency) ?? "₹";
    if (r.workflow_key === "po_cancellation") {
      out[r.subject_id] = {
        kind: "cancel",
        code: str(c.request_code),
        poCode: str(c.po_code),
        scope: c.scope === "whole" ? "whole" : "partial",
        currency,
        cancelValue: num(c.cancel_value),
        reason: str(c.reason),
        lines: (Array.isArray(c.lines) ? (c.lines as Ctx[]) : []).map((l) => ({
          item: str(l.item),
          uom: str(l.uom),
          orderedQty: num(l.ordered_qty),
          receivedQty: num(l.received_qty),
          openQty: num(l.open_qty),
          cancelQty: num(l.cancel_qty),
        })),
      };
      continue;
    }
    const gstPct = num(c.gst_pct);
    const prev = num(c.previous_rate);
    const next = num(c.revised_rate);
    const line = lineById.get(str(c.po_line_item_id) ?? "");
    let budgetRate: number | null = null;
    let overPerUnit: number | null = null;
    let profitHit: number | null = null;
    if (line && variance) {
      const head = fxByPo.get(line.purchase_order_id) ?? { fx: 1, gst: 0 };
      // The revised rate in the line's place — the rate the approve would write.
      const asRevised = { ...line, unit_price: next, gst_pct: gstPct, quantity: num(c.quantity) || line.quantity };
      const impact = poBudgetImpact([asRevised], variance, { fx: head.fx, defaultGstPct: head.gst });
      budgetRate = impact.budgetOf(asRevised);
      if (budgetRate != null) {
        overPerUnit = Math.max(0, impact.netRateOf(asRevised) * head.fx - budgetRate);
        profitHit = impact.profitHit;
      }
    }
    out[r.subject_id] = {
      kind: "rate",
      code: str(c.amendment_code),
      poCode: str(c.po_code),
      item: str(c.item),
      quantity: num(c.quantity),
      currency,
      previousRate: prev,
      revisedRate: next,
      gstPct,
      previousRateGst: budgetRateOf(prev, gstPct),
      revisedRateGst: budgetRateOf(next, gstPct),
      valueChange: num(c.revised_value) - num(c.previous_value),
      reason: str(c.reason),
      hasBudget: c.has_budget === true,
      budgetRate,
      overPerUnit,
      profitHit,
    };
  }
  return out;
}
