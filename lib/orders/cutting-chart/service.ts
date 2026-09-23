import "server-only";
import { createClient } from "@/lib/supabase/server";
import { excessQty, projectionQty } from "@/lib/orders/amendments/approval-qty";
import { rejectionTiersById, sizeNamesById } from "@/lib/orders/bom-order-basis";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { naturalSizeOrder } from "@/lib/masters/size-order";
import type { CuttingChart, CuttingFigures } from "./types";

export type { CuttingChart, CuttingFigures, CuttingColour, CuttingStyle } from "./types";

/**
 * THE CUTTING CHART (client 2026-09-23, the legacy RP "CUTTING CHART" printout)
 * — per style ▸ colour, sizes across: Order, Excess, Approval, Rej.Allow and the
 * Total the cutting table is asked for.
 *
 * ## THE APPROVAL QTY TAB'S ARITHMETIC, CELL FOR CELL — NEVER A SECOND FORMULA
 *
 * Every figure is one stored `garment_order_amendment_approval_qtys` row (one per
 * style × combo × size since 0435) run through the SAME two functions the tab's
 * `derive` and the Fabric BOM's `qtyBreakdownOf` call: `excessQty` (rounds up
 * PER SIZE) and `projectionQty` (the Garment Rejection Rule, per size — the
 * grain the rule is bracketed on). So the RE total's Cut Qty here equals the
 * Fabric BOM Entry Register's header Cut Qty for the same order by construction:
 * same rows, same functions, summed the same way.
 *
 * ## IT REFUSES WHERE `qtyBreakdownOf` REFUSES
 *
 * No approval rows → nothing has been entered to cut. A rule chosen on the order
 * that leaves a size's quantity in a tier gap → the defect buffer is
 * unanswered, and a chart that printed 0 there would send the cutting table
 * short. Both come back as the sentence, never as an empty or zeroed chart.
 *
 * PLAIN DATA ONLY: V_final (0619) freezes this object into jsonb verbatim.
 */
export async function getCuttingChart(salesOrderId: string): Promise<CuttingChart | { refused: string }> {
  const s = await createClient();

  const { data: so, error: soErr } = await s
    .from("sales_orders")
    .select("id, order_number, order_date, location_id")
    .eq("id", salesOrderId)
    .maybeSingle();
  if (soErr) return { refused: `Could not read the order: ${soErr.message}` };
  if (!so) return { refused: "No such order." };
  const order = so as { id: string; order_number: string | null; order_date: string | null; location_id: string | null };

  /* THE CURRENT GARMENT ORDER — the latest amendment, the rule the Garment
     Order Sheet resolves the same URL with (`getGarmentOrderSheet`). */
  const { data: seq, error: seqErr } = await s
    .from("garment_order_amendments")
    .select(
      "id, po_no, amend_date, delivery_date, excess_pct, rejection_rule_id, customer:customers(name)",
    )
    .eq("sales_order_id", salesOrderId)
    .order("amend_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (seqErr) return { refused: `Could not read the order's Garment Order: ${seqErr.message}` };
  const goRows = (seq ?? []) as unknown as {
    id: string;
    po_no: string | null;
    amend_date: string | null;
    delivery_date: string | null;
    excess_pct: number | string | null;
    rejection_rule_id: string | null;
    customer: { name: string | null } | null;
  }[];
  const go = goRows[goRows.length - 1];
  if (!go) {
    return {
      refused: `Order ${order.order_number ?? salesOrderId} has no Garment Order entered against it, so there is nothing to cut.`,
    };
  }

  const [approvalRes, styleRes, coRes, locRes, tiersById, sizeNames] = await Promise.all([
    s
      .from("garment_order_amendment_approval_qtys")
      .select("style_ref_no, combo, size_id, qty, approval_qty, sno")
      .eq("amendment_id", go.id)
      .order("sno", { ascending: true }),
    s
      .from("garment_order_amendment_styles")
      .select("style_ref_no, style_description, description, sno, style:garment_styles!style_id(style_name)")
      .eq("amendment_id", go.id)
      .order("sno", { ascending: true }),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    order.location_id
      ? s.from("locations").select("name").eq("id", order.location_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    rejectionTiersById(),
    sizeNamesById(),
  ]);
  if (approvalRes.error) return { refused: `Could not read the order's Approval Qty: ${approvalRes.error.message}` };
  if (styleRes.error) return { refused: `Could not read the order's styles: ${styleRes.error.message}` };
  if (locRes.error) return { refused: `Could not read the order's unit: ${locRes.error.message}` };

  const approvals = ((approvalRes.data ?? []) as {
    style_ref_no: string | null;
    combo: string | null;
    size_id: string | null;
    qty: number | string | null;
    approval_qty: number | string | null;
  /* A row with no ordered pieces is skipped WHOLE — approval included — exactly
     as `qtyBreakdownOf` skips it, so the two Cut Qty totals cannot differ. */
  }[]).filter((a) => (Number(a.qty) || 0) > 0);
  if (approvals.length === 0) {
    return { refused: "No production quantity yet — fill Approval Qty on the order" };
  }

  const excessPct = Number(go.excess_pct) || 0;
  const ruleChosen = !!go.rejection_rule_id;
  const tiers = go.rejection_rule_id ? (tiersById.get(go.rejection_rule_id) ?? null) : null;

  const styles = (styleRes.data ?? []) as unknown as {
    style_ref_no: string | null;
    style_description: string | null;
    description: string | null;
    style: { style_name: string | null } | null;
  }[];
  const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

  /* SIZES ACROSS, ONE SET FOR THE WHOLE CHART — legacy prints one header row of
     sizes and every block (and the RE total) lines up under it. Natural size
     order (XS S M L XL 1X 2X 3X), never alphabetic. */
  const sizeLabel = (id: string | null) => (id ? (sizeNames[id] ?? "?") : "—");
  const sizeIds = [...new Set(approvals.map((a) => a.size_id ?? ""))].sort((a, b) =>
    naturalSizeOrder(sizeLabel(a || null), sizeLabel(b || null)),
  );
  const sizes = sizeIds.map((id) => ({ key: id, label: sizeLabel(id || null) }));
  const zero = (): CuttingFigures => ({
    order: sizes.map(() => 0),
    excess: sizes.map(() => 0),
    approval: sizes.map(() => 0),
    rejection: sizes.map(() => 0),
    total: sizes.map(() => 0),
  });

  type StyleAcc = { styleRefNo: string; colours: { combo: string; figures: CuttingFigures }[] };
  const byStyle: StyleAcc[] = [];
  const total = zero();

  for (const a of approvals) {
    const qty = Number(a.qty) || 0;
    const approval = Math.max(0, Number(a.approval_qty) || 0);
    const rejection = projectionQty(qty, tiers);
    if (ruleChosen && rejection == null) {
      return {
        refused: `${a.combo || a.style_ref_no || "(blank)"} ${sizeLabel(a.size_id)}: the Garment Rejection Rule has no tier covering ${qty} pcs — fix the rule or clear it on the order`,
      };
    }
    const excess = excessQty(qty, excessPct);
    const rej = rejection ?? 0;

    const refNo = (a.style_ref_no ?? "").trim();
    let st = byStyle.find((x) => norm(x.styleRefNo) === norm(refNo));
    if (!st) byStyle.push((st = { styleRefNo: refNo, colours: [] }));
    const combo = (a.combo ?? "").trim();
    let col = st.colours.find((c) => norm(c.combo) === norm(combo));
    if (!col) st.colours.push((col = { combo, figures: zero() }));

    const i = sizeIds.indexOf(a.size_id ?? "");
    for (const f of [col.figures, total]) {
      f.order[i] += qty;
      f.excess[i] += excess;
      f.approval[i] += approval;
      f.rejection[i] += rej;
      f.total[i] += qty + excess + approval + rej;
    }
  }

  /* Blocks in the order's own Style(s) sequence; a style with approval rows
     but no style row (a renamed ref) keeps its place at the end. */
  const rank = (ref: string) => {
    const i = styles.findIndex((x) => norm(x.style_ref_no) === norm(ref));
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  byStyle.sort((a, b) => rank(a.styleRefNo) - rank(b.styleRefNo));

  const sum = (xs: number[]) => xs.reduce((p, x) => p + x, 0);
  const orderQty = sum(total.order);
  const approvalQty = sum(total.approval);
  const excessTotal = sum(total.excess);
  const rejectionQty = sum(total.rejection);

  const co = coRes.data as Record<string, unknown> | null;
  const str = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);

  return {
    header: {
      scNo: order.order_number,
      date: order.order_date ?? go.amend_date,
      customer: go.customer?.name ?? null,
      /* One delivery date on the order, not a window — printed in both slots
         as the Fabric BOM reports do (`loadBomDocHeader`). */
      deliveryFrom: go.delivery_date,
      deliveryTo: go.delivery_date,
      orderNo: go.po_no,
      excessPct,
      orderQty,
      excessQty: excessTotal,
      approvalQty,
      /* NET QTY = ORDER + EXCESS + APPROVAL — legacy's 3024 + 25 = 3049: what is
         owed to the buyer and the sampling desk, before the defect buffer. */
      netQty: orderQty + excessTotal + approvalQty,
      rejectionQty,
      cutQty: orderQty + excessTotal + approvalQty + rejectionQty,
      company: {
        name: str("name") ?? str("company_name"),
        address: registeredAddressOf(co),
        unit: (locRes.data as { name: string | null } | null)?.name ?? null,
        gstin: str("gstin"),
        logo: letterheadLogoOf(co),
      },
    },
    sizes,
    styles: byStyle.map((st) => {
      const row = styles.find((x) => norm(x.style_ref_no) === norm(st.styleRefNo));
      return {
        styleRefNo: st.styleRefNo || null,
        styleName: row ? (row.style?.style_name ?? row.description ?? row.style_description ?? null) : null,
        colours: st.colours.map((c) => ({ combo: c.combo || "—", figures: c.figures })),
      };
    }),
    total,
  };
}
