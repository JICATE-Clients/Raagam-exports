"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { refuseReopenedBudget, refuseUnsettledMaterials } from "@/lib/purchase/bom-ceiling-service";
import { getRequirementLines, getVendorsForClass } from "./service";
import {
  capQty,
  gstSlab,
  lineDescription,
  lineGst,
  lineKeyOf,
  withNote,
  poTotals,
  rePoInput,
  type BudgetFlag,
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
  | { ok: true; poId: string; code: string | null; status: "draft" | "approved" | "pending_approval"; aboveCount: number }
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
  const lines: { req: RequirementLine; qty: number; rate: number | null; delivery_date: string; note: string | null; gst_pct: number | null }[] = [];
  for (const l of input.lines) {
    if (l.qty <= 0) continue; // qty 0 = "not ordered on this PO"
    const req = byKey.get(lineKeyOf(l));
    if (!req) return { ok: false, error: "A line is no longer on that RE's requirement sheet — reload the screen" };
    if (capQty(l.qty, req.balance_qty) < l.qty) {
      return {
        ok: false,
        error: `${lineDescription(req)} (${req.source_no}): only ${req.balance_qty} ${req.uom_code ?? ""} is left to buy — excess quantity is not allowed`,
      };
    }
    lines.push({ req, qty: l.qty, rate: l.rate, delivery_date: l.delivery_date, note: l.note ?? null, gst_pct: l.gst_pct ?? null });
  }
  if (lines.length === 0) return { ok: false, error: "Every line has quantity 0 — there is nothing to order" };

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
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the vendors" };
  }
  if (mode === "submit" && lines.some((l) => !l.rate || l.rate <= 0)) {
    return { ok: false, error: "Every line needs a rate before the PO is submitted" };
  }

  const fx = input.po_type === "import" ? (input.exchange_rate ?? 0) : 1;
  let aboveCount = 0;
  let unbudgeted = 0;
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
          rate: l.rate == null ? null : l.rate * fx,
        })),
      );
      aboveCount = flags.filter((f) => f.above).length;
      unbudgeted = flags.filter((f) => !f.hasBudget).length;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "The budget check failed" };
    }
  }

  const slab = gstSlab(input.gst);
  // GST line by line (0756): each line's own slab, else the header's default.
  const totals = poTotals(lines.map((l) => ({ qty: l.qty, rate: l.rate ?? 0, gstPct: l.gst_pct })), slab.pct);
  /* Add − Less from the Commercial section, in the PO's currency like the rates. */
  const chargesNet = input.charges.reduce((a, c) => a + (c.kind === "less" ? -1 : 1) * c.amount, 0);
  const grand = Math.round((totals.total + chargesNet) * 100) / 100;
  const status: "draft" | "approved" | "pending_approval" =
    mode === "draft" ? "draft" : aboveCount > 0 || unbudgeted > 0 ? "pending_approval" : "approved";
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
      ...(input.commercial ?? {}),
      expected_date: latestDelivery,
      order_date: new Date().toISOString().slice(0, 10),
      status,
      created_by: user?.id ?? null,
      approved_by: status === "approved" ? (user?.id ?? null) : null,
      approved_at: status === "approved" ? new Date().toISOString() : null,
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

  revalidatePath("/purchase/orders");
  revalidatePath("/purchase/requirement-po");
  return { ok: true, poId: poRow.id, code: poRow.code, status, aboveCount: aboveCount + unbudgeted };
}
