"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { refuseReopenedBudget, refuseUnsettledMaterials } from "@/lib/purchase/bom-ceiling-service";
import { getRequirementLines, getVendorsForClass, withApprovedBudgets } from "./service";
import { notifyPoAboveBudget } from "@/lib/purchase/po-escalation";
import { startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { poItemClasses } from "@/lib/purchase/po-routing";
import {
  bomDiaOf,
  budgetWords,
  gstSlab,
  lineDescription,
  lineGst,
  lineKeyOf,
  lineKindOf,
  qtyAllowed,
  withNote,
  poTotals,
  budgetRateOf,
  rePoInput,
  type BudgetFlag,
  type LastPurchase,
  type LastRate,
  type RePoInput,
  type RequirementLine,
} from "./types";

type CheckLine = {
  key: string;
  /** NULL for an IWO / SWO line: it has no order budget, so it reads "no approved budget" (→ MD). */
  garment_order_id: string | null;
  item_id: string;
  uom_id: string | null;
  slice_label: string;
  colour: string | null;
  /** In RUPEES — an import rate is converted before it is compared. */
  rate: number | null;
};

async function budgetFlags(lines: readonly CheckLine[]): Promise<BudgetFlag[]> {
  if (lines.length === 0) return [];
  const s = await createClient();
  const { data, error } = await s.rpc("po_budget_check", { p_lines: lines });
  if (error) throw new Error(`Could not check the rates against the budget: ${error.message}`);
  return ((data ?? []) as { key: string; has_budget: boolean; above: boolean }[]).map((r) => ({
    key: r.key,
    hasBudget: r.has_budget,
    above: r.above,
  }));
}

/**
 * THE HIDDEN BUDGET CHECK (spec point 7) — the screen asks, per priced line,
 * "is this above the approved budget?" and gets a yes or no. The figure stays
 * inside `po_budget_check`.
 */
/**
 * SHOW LAST PO (user 2026-10-26, Task 3) — the most recent purchase orders that bought
 * this item, newest first: rate, vendor, PO No and date, quantity and unit. Asked when
 * the row's pop-up opens, not for every line on load.
 *
 * Drafts and cancelled POs are not "a purchase": a draft is nobody's agreed rate yet,
 * and a cancelled one never happened. The many-to-one embeds name their FK column —
 * `purchase_orders` already has two FKs to `vendors` (AGENTS, A second FK breaks every
 * existing embed); `po_line_items` has one FK to `purchase_orders`, so `!inner` alone.
 */
export async function getLastPurchases(
  itemId: string,
  limit = 3,
): Promise<{ ok: true; rows: LastPurchase[] } | { ok: false; error: string }> {
  if (!(await can("materials_purchase", "view"))) return { ok: false, error: "You cannot see purchase orders" };
  const s = await createClient();
  const { data, error } = await s
    .from("purchase_orders")
    .select(
      "id, code, order_date, created_at, status, currency_code, foreign_currency_code, po_type, master_vendors!master_vendor_id(name), po_line_items!inner(item_id, quantity, unit_price, uoms!uom_id(code))",
    )
    .eq("po_line_items.item_id", itemId)
    .not("status", "in", "(draft,cancelled)")
    .order("order_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 10));
  // A failed query is an error, not "never bought" — that would read as a real answer.
  if (error) return { ok: false, error: `Could not read the earlier POs: ${error.message}` };
  type Row = {
    id: string;
    code: string | null;
    order_date: string | null;
    status: string;
    currency_code: string | null;
    foreign_currency_code: string | null;
    po_type: string | null;
    master_vendors: { name: string | null } | null;
    po_line_items: { quantity: number | string; unit_price: number | string; uoms: { code: string | null } | null }[];
  };
  const rows = ((data ?? []) as unknown as Row[]).map((p) => {
    const rates = p.po_line_items.map((l) => Number(l.unit_price) || 0).filter((r) => r > 0);
    return {
      poId: p.id,
      code: p.code,
      orderDate: p.order_date,
      status: p.status,
      vendor: p.master_vendors?.name ?? null,
      currency: (p.po_type === "import" ? p.foreign_currency_code : null) ?? p.currency_code ?? "INR",
      rateMin: rates.length ? Math.min(...rates) : 0,
      rateMax: rates.length ? Math.max(...rates) : 0,
      qty: p.po_line_items.reduce((a, l) => a + (Number(l.quantity) || 0), 0),
      uom: p.po_line_items[0]?.uoms?.code ?? null,
    } satisfies LastPurchase;
  });
  return { ok: true, rows };
}

/**
 * LAST RATE PER ITEM (user 2026-10-27) — one round trip for every item on the grid, so
 * the Rate box opens pre-filled on a second PO for the same item. Same rules as Show Last
 * PO: drafts and cancelled POs are not a purchase. Per item, the chosen vendor's newest PO
 * wins; with none, the newest from anyone. A PO that priced the item's sizes apart gives
 * its lowest rate — the figure to negotiate down from, never up.
 */
export async function getLastRates(
  itemIds: readonly string[],
  vendorId: string | null,
  currency: string,
): Promise<{ ok: true; rates: Record<string, LastRate>; bought: string[] } | { ok: false; error: string }> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: true, rates: {}, bought: [] };
  if (!(await can("materials_purchase", "view"))) return { ok: false, error: "You cannot see purchase orders" };
  const s = await createClient();
  const { data, error } = await s
    .from("purchase_orders")
    .select(
      "id, code, order_date, created_at, status, master_vendor_id, currency_code, foreign_currency_code, po_type, master_vendors!master_vendor_id(name), po_line_items!inner(item_id, unit_price)",
    )
    .in("po_line_items.item_id", ids)
    .not("status", "in", "(draft,cancelled)")
    .order("order_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return { ok: false, error: `Could not read the last rates: ${error.message}` };
  type Row = {
    code: string | null;
    order_date: string | null;
    master_vendor_id: string | null;
    currency_code: string | null;
    foreign_currency_code: string | null;
    po_type: string | null;
    master_vendors: { name: string | null } | null;
    po_line_items: { item_id: string; unit_price: number | string }[];
  };
  const rates: Record<string, LastRate> = {};
  // Every item on ANY real PO, whatever its currency or vendor — what decides whether the
  // grid offers Show Last PO at all (user 2026-10-27: "only show if that item have the data").
  const bought = new Set<string>();
  for (const p of (data ?? []) as unknown as Row[]) {
    for (const l of p.po_line_items) bought.add(l.item_id);
    const cur = (p.po_type === "import" ? p.foreign_currency_code : null) ?? p.currency_code ?? "INR";
    if (cur !== currency) continue;
    const same = !!vendorId && p.master_vendor_id === vendorId;
    const byItem = new Map<string, number>();
    for (const l of p.po_line_items) {
      const r = Number(l.unit_price) || 0;
      if (r > 0) byItem.set(l.item_id, Math.min(byItem.get(l.item_id) ?? r, r));
    }
    for (const [itemId, rate] of byItem) {
      const had = rates[itemId];
      // Newest first, so the first hit stands — unless it was another vendor's and this is ours.
      if (had && (had.sameVendor || !same)) continue;
      rates[itemId] = { rate, currency: cur, sameVendor: same, vendor: p.master_vendors?.name ?? null, code: p.code, orderDate: p.order_date };
    }
  }
  return { ok: true, rates, bought: [...bought] };
}

export async function checkRatesAgainstBudget(
  lines: readonly CheckLine[],
): Promise<{ ok: true; flags: BudgetFlag[] } | { ok: false; error: string }> {
  if (!(await can("materials_purchase", "view"))) return { ok: false, error: "Forbidden" };
  try {
    return { ok: true, flags: await budgetFlags(lines) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The budget check failed" };
  }
}

export type SavePoResult =
  | { ok: true; poId: string; code: string | null; status: "draft" | "approved" | "pending_approval"; aboveCount: number; unbudgetedCount: number }
  | { ok: false; error: string };

/**
 * SAVE (draft) or SUBMIT a PO raised from requirement lines.
 *
 * Every rule the screen shows is decided AGAIN here, against the database as it
 * is now — the screen is a courtesy, this is the guard:
 *
 * - the vendor is a bought-item vendor of the chosen item class (spec 2);
 * - every line belongs to the chosen REs and class, and its qty is at most the
 *   balance still to buy — counted now, so a PO saved by someone else since the
 *   screen opened is taken into account (spec 6);
 * - on SUBMIT every line has a rate, and the hidden budget check decides the
 *   route: all within → APPROVED by rule, the submitter recorded as approver
 *   (spec flow "Direct System Approval"); any above, or a line with no approved
 *   budget to compare against → PENDING APPROVAL for the MD, print locked
 *   (spec 7–8). A draft is checked for balance only.
 */
export async function savePoFromRequirement(raw: RePoInput, mode: "draft" | "submit"): Promise<SavePoResult> {
  if (!(await can("materials_purchase", "create"))) return { ok: false, error: "You cannot raise purchase orders" };
  const parsed = rePoInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the PO" };
  const input = parsed.data;

  let requirement: RequirementLine[];
  try {
    requirement = await getRequirementLines(input.source_ids);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the requirement" };
  }

  const byKey = new Map(requirement.map((r) => [lineKeyOf(r), r]));
  const lines: {
    req: RequirementLine;
    qty: number;
    rate: number | null;
    delivery_date: string;
    note: string | null;
    gst_pct: number | null;
    bags: number | null;
    bag_weight: number | null;
    rolls: number | null;
    gauge: string | null;
    ply: string | null;
    loop_length: string | null;
  }[] = [];
  for (const l of input.lines) {
    if (l.qty <= 0) continue; // qty 0 = "not ordered on this PO"
    const req = byKey.get(lineKeyOf(l));
    if (!req) return { ok: false, error: "A line is no longer on that RE's requirement sheet — reload the screen" };
    // Bags and their weight travel together (0758). The weight may be typed below bags × bag
    // weight (a part-filled last bag, 2026-10-28); above To Order, qtyAllowed holds it to whole bags.
    if ((l.bags == null) !== (l.bag_weight == null)) {
      return { ok: false, error: `${lineDescription(req)} (${req.source_no}): the bags need their bag weight — reload the screen` };
    }
    // Never above what is left — except by whole bags, and then by less than one (0758).
    if (!qtyAllowed(l.qty, req.balance_qty, l.bags, l.bag_weight)) {
      return {
        ok: false,
        error: `${lineDescription(req)} (${req.source_no}): only ${req.balance_qty} ${req.uom_code ?? ""} is left to buy — excess quantity is not allowed`,
      };
    }
    lines.push({
      req,
      qty: l.qty,
      rate: l.rate,
      delivery_date: l.delivery_date,
      note: l.note ?? null,
      gst_pct: l.gst_pct ?? null,
      bags: l.bags ?? null,
      bag_weight: l.bag_weight ?? null,
      rolls: l.rolls ?? null,
      gauge: l.gauge ?? null,
      ply: l.ply ?? null,
      loop_length: l.loop_length ?? null,
    });
  }
  if (lines.length === 0) return { ok: false, error: "Every line has quantity 0 — there is nothing to order" };

  // Only an order with an approved budget is bought for (withApprovedBudgets, 2026-10-28) —
  // asked again here, so a tab opened before a budget went back to draft cannot raise one.
  try {
    const { lines: allowed } = await withApprovedBudgets(lines.map((l) => l.req));
    const ok = new Set(allowed.map(lineKeyOf));
    const blocked = lines.find((l) => !ok.has(lineKeyOf(l.req)));
    if (blocked) return { ok: false, error: `${blocked.req.source_no}: its order budget is not approved — a PO can be raised only after the MD approves it` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the order budgets" };
  }

  /* THE VENDOR SUPPLIES EVERY CLASS ON THE PO (spec point 2). The class is the line's
     (2026-10-23 — it left the header), so the check is per class: the vendor must be a
     bought-item vendor mapped to each one, read again here, not taken from the screen. */
  const classIds = [...new Set(lines.map((l) => l.req.item_class_id ?? ""))];
  if (classIds.includes("")) return { ok: false, error: "A line's item has no item class — set it in Master Data ▸ Materials" };
  try {
    const lists = await Promise.all(classIds.map((id) => getVendorsForClass(id)));
    const missing = classIds.filter((_, i) => !lists[i].some((v) => v.id === input.vendor_id));
    if (missing.length) {
      const names = missing.map((id) => lines.find((l) => l.req.item_class_id === id)?.req.item_class ?? "a class");
      return { ok: false, error: `That vendor is not a bought-item vendor for ${names.join(", ")} — check Master Data ▸ Vendors` };
    }
    // LOCAL / IMPORT DECIDES THE VENDOR (0773, user 2026-10-31): a foreign vendor only on
    // an Import PO, an Indian one only on a Local PO — the screen's list, checked again here.
    const picked = lists[0]?.find((v) => v.id === input.vendor_id);
    if (picked && picked.is_import !== (input.po_type === "import")) {
      return {
        ok: false,
        error: picked.is_import
          ? "That vendor is outside India — raise it as an Import PO"
          : "That vendor is in India — raise it as a Local PO, or pick an import vendor",
      };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the vendors" };
  }
  if (mode === "submit" && lines.some((l) => !l.rate || l.rate <= 0)) {
    return { ok: false, error: "Every line needs a rate before the PO is submitted" };
  }

  const fx = input.po_type === "import" ? (input.exchange_rate ?? 0) : 1;
  const slab = gstSlab(input.gst);
  let aboveCount = 0;
  let unbudgeted = 0;
  /** Lines that send the PO to the MD — above budget, or with no approved budget. */
  const escalated = new Set<string>();
  if (mode === "submit") {
    const gateLines = lines.map((l) => ({ sales_order_id: l.req.sales_order_id, iwo_id: l.req.iwo_id, item_id: l.req.item_id }));
    const reopened = await refuseReopenedBudget(gateLines);
    if (reopened) return { ok: false, error: reopened };
    const unsettled = await refuseUnsettledMaterials(gateLines);
    if (unsettled) return { ok: false, error: unsettled };
    try {
      const flags = await budgetFlags(
        lines.map((l) => ({
          key: lineKeyOf(l.req),
          garment_order_id: l.req.garment_order_id,
          item_id: l.req.item_id,
          uom_id: l.req.uom_id,
          slice_label: l.req.slice_label,
          colour: l.req.colour,
          // GST-inclusive budget (re-po/types.ts, 2026-10-31): the rate with this line's GST.
          rate: l.rate == null ? null : budgetRateOf(l.rate, l.gst_pct ?? slab.pct) * fx,
        })),
      );
      aboveCount = flags.filter((f) => f.above).length;
      unbudgeted = flags.filter((f) => !f.hasBudget).length;
      for (const f of flags) if (f.above || !f.hasBudget) escalated.add(f.key);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "The budget check failed" };
    }
  }

  // GST line by line (0756): each line's own slab, else the header's default.
  const totals = poTotals(lines.map((l) => ({ qty: l.qty, rate: l.rate ?? 0, gstPct: l.gst_pct })), slab.pct);
  /* Add − Less from the Commercial section, in the PO's currency like the rates. */
  const chargesNet = input.charges.reduce((a, c) => a + (c.kind === "less" ? -1 : 1) * c.amount, 0);
  const grand = Math.round((totals.total + chargesNet) * 100) / 100;
  /* EVERY PO IS APPROVED (user 2026-10-28, 0765): inside budget no longer means
     approved by rule — it goes to the item class's approver, above budget to the MD.
     `escalated` is what routes it there (the run's `above_budget`). */
  const isAbove = aboveCount > 0 || unbudgeted > 0;
  const status: "draft" | "approved" | "pending_approval" = mode === "draft" ? "draft" : "pending_approval";
  // The reason is mandatory for the MD (user 2026-10-27) — checked here too, not only on screen.
  if (isAbove && mode !== "draft" && !input.budget_reason?.trim())
    return { ok: false, error: `${budgetWords(aboveCount, unbudgeted)} — give the reason before it goes to the MD` };
  const user = await getAppUser();
  const latestDelivery = lines.map((l) => l.delivery_date).sort().at(-1) ?? null;

  const s = await createClient();
  const { data: po, error: poErr } = await s
    .from("purchase_orders")
    .insert({
      master_vendor_id: input.vendor_id,
      po_type: input.po_type,
      currency_code: "INR",
      foreign_currency_code: input.po_type === "import" ? input.currency_code : null,
      exchange_rate: input.po_type === "import" ? input.exchange_rate : null,
      foreign_total_amount: input.po_type === "import" ? grand : null,
      total_amount: Math.round(grand * fx * 100) / 100,
      gst_pct: slab.pct,
      gst_kind: slab.kind,
      gst_amount: totals.gst,
      payment_terms: input.payment_terms,
      // Only a PO that goes to the MD carries a reason; one inside budget has nothing to explain.
      ...(isAbove && status === "pending_approval" && input.budget_reason ? { budget_reason: input.budget_reason } : {}),
      ...(input.commercial ?? {}),
      expected_date: latestDelivery,
      order_date: new Date().toISOString().slice(0, 10),
      status,
      created_by: user?.id ?? null,
    })
    .select("id, code")
    .single();
  if (poErr || !po) return { ok: false, error: `The PO could not be saved: ${poErr?.message ?? "no row"}` };
  const poRow = po as { id: string; code: string | null };

  const { error: lineErr } = await s.from("po_line_items").insert(
    lines.map((l, i) => ({
      purchase_order_id: poRow.id,
      item_id: l.req.item_id,
      // "MAIN LABEL · L (PROCESS: CUT & SEAL)" — the print, GRN and stock logs read this (0755).
      description: withNote(lineDescription(l.req), l.note).toUpperCase(),
      note: l.note,
      // Stored as the slab that APPLIED — the default written out, so a line never needs its header to be read.
      gst_pct: l.gst_pct ?? slab.pct,
      gst_amount: lineGst({ qty: l.qty, rate: l.rate ?? 0, gstPct: l.gst_pct }, slab.pct),
      // Yarn bags / fabric rolls & dia (0758); rolls is a 0-default int column from 0359.
      bags: l.bags,
      bag_weight: l.bag_weight,
      rolls: l.rolls ?? 0,
      /* DIA · GSM ARE THE PLAN'S, NEVER TYPED (user 2026-10-30 spec). Read off the
         requirement line the server just re-fetched, so a stale tab or a hand-made request
         cannot put a figure on the vendor's PO that the plan does not hold. GAUGE · LOOP
         LENGTH are PO-only and typed on Raise PO (user 2026-10-30, off the Fabric BOM).
         The PO line keeps all four as it said them when raised (0762). */
      dia: bomDiaOf(l.req),
      gsm: lineKindOf(l.req.item_class) === "fabric" ? l.req.gsm : null,
      gauge: lineKindOf(l.req.item_class) === "fabric" ? l.gauge : null,
      // Ply apart from Gauge; LL in cm as free text (0774, user 2026-10-31).
      ply: lineKindOf(l.req.item_class) === "fabric" ? l.ply : null,
      loop_length: lineKindOf(l.req.item_class) === "fabric" ? l.loop_length : null,
      quantity: l.qty,
      uom_id: l.req.uom_id,
      unit_price: l.rate ?? 0,
      amount: Math.round(l.qty * (l.rate ?? 0) * 100) / 100,
      delivery_date: l.delivery_date,
      // An RE line links its order, an IWO / SWO line its work order — never both (chk_poli_one_source).
      sales_order_id: l.req.sales_order_id,
      garment_order_id: l.req.garment_order_id,
      iwo_id: l.req.iwo_id,
      req_key: l.req.req_key,
      item_class: l.req.item_class,
      sort_order: i,
    })),
  );
  if (lineErr) {
    // No half PO: the header goes too (its lines cascade).
    await s.from("purchase_orders").delete().eq("id", poRow.id);
    return { ok: false, error: `The PO lines could not be saved: ${lineErr.message}` };
  }

  if (input.charges.length) {
    const { error: chErr } = await s.from("po_additional_charges").insert(
      input.charges.map((c, i) => ({
        purchase_order_id: poRow.id,
        charge_type: c.kind,
        label: c.label,
        rate: 0,
        inr_amount: Math.round(c.amount * fx * 100) / 100,
        fgn_amount: input.po_type === "import" ? c.amount : 0,
        sort_order: i,
      })),
    );
    if (chErr) {
      await s.from("purchase_orders").delete().eq("id", poRow.id);
      return { ok: false, error: `The PO charges could not be saved: ${chErr.message}` };
    }
  }

  if (status === "pending_approval") {
    const items = [...new Set(lines.filter((l) => escalated.has(lineKeyOf(l.req))).map((l) => l.req.item_name.toUpperCase()))];
    const total = `${input.po_type === "import" ? (input.currency_code ?? "") : "₹"} ${grand.toFixed(2)}`;
    /* INTO MY APPROVALS (user 2026-10-28, 0764): the run is the MD's request, and its
       end writes the PO (`purchase_order_apply_decision`). The context is what the
       MD's alert and inbox card say — frozen as sent, like a budget's summary. */
    const started = await startApproval({
      workflowKey: WORKFLOWS.purchase_order.key,
      subjectTable: WORKFLOWS.purchase_order.subjectTable,
      subjectId: poRow.id,
      context: {
        po_code: poRow.code,
        items,
        total,
        reason: input.budget_reason ?? null,
        above_count: aboveCount,
        unbudgeted_count: unbudgeted,
        /* WHAT ROUTES IT (0765): above budget → the MD's flow; otherwise the first
           flow whose classes include any of this PO's — most senior first. */
        above_budget: isAbove,
        item_classes: await poItemClasses(poRow.id),
      },
    });
    if (!started.ok) {
      /* NO FLOW COULD TAKE IT (nobody holds the flow's role, or the flow is off).
         The PO still waits the pre-0764 way — the PO page's own Approve (and the MD's
         alert when it is above budget) — rather than failing a save the Purchase
         Manager cannot fix. Logged, so Approval Flows gets looked at. */
      console.error(`[raise-po] ${poRow.code}: not routed to My Approvals — ${started.error}`);
      if (isAbove)
        await notifyPoAboveBudget({ id: poRow.id, code: poRow.code, items, reason: input.budget_reason ?? null, total });
    }
  }

  revalidatePath("/purchase/orders");
  revalidatePath("/purchase/requirement-po");
  return { ok: true, poId: poRow.id, code: poRow.code, status, aboveCount, unbudgetedCount: unbudgeted };
}
