"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { amendmentInput, type AmendmentInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/amendments");
  revalidatePath("/orders");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------- child normalizers (drop fully-empty rows + renumber sno) ----------

function normalizeCharges(data: AmendmentInput) {
  return data.charges
    .map((c) => ({
      section: c.section === "add" ? "add" : "less",
      label: clean(c.label),
      calc_mode: clean(c.calc_mode),
      amount: Number(c.amount) || 0,
      unit: clean(c.unit),
    }))
    .filter((c) => c.label || c.calc_mode || c.amount || c.unit)
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

function normalizeStylePrices(data: AmendmentInput) {
  return data.style_prices
    .map((p) => ({
      style_ref_no: clean(p.style_ref_no),
      style: clean(p.style),
      price: Number(p.price) || 0,
      csp_type: clean(p.csp_type),
      csp_price: Number(p.csp_price) || 0,
      fob_buyer_price: Number(p.fob_buyer_price) || 0,
      fob_selling_price: Number(p.fob_selling_price) || 0,
    }))
    .filter(
      (p) =>
        p.style_ref_no ||
        p.style ||
        p.price ||
        p.csp_type ||
        p.csp_price ||
        p.fob_buyer_price ||
        p.fob_selling_price,
    )
    .map((p, i) => ({ ...p, sno: i + 1 }));
}

// ---- Phase 2 (0128) child normalizers ----

function normalizeStyles(data: AmendmentInput) {
  return data.styles
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style_id: r.style_id,
      article_no: clean(r.article_no),
      style_category: clean(r.style_category),
      style_description: clean(r.style_description),
      order_unit_id: r.order_unit_id,
      plan_unit_id: r.plan_unit_id,
      po_qty: Number(r.po_qty) || 0,
      description: clean(r.description),
    }))
    .filter(
      (r) =>
        r.style_ref_no ||
        r.style_id ||
        r.article_no ||
        r.order_unit_id ||
        r.plan_unit_id ||
        r.po_qty ||
        r.description,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizeDyeings(data: AmendmentInput) {
  return data.dyeings
    .map((r) => ({
      section: r.section === "fabric" ? "fabric" : "yarn",
      dye_type: clean(r.dye_type),
      color_id: r.color_id,
    }))
    .filter((r) => r.dye_type || r.color_id)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizePrints(data: AmendmentInput) {
  return data.prints
    .map((r) => ({ print_id: r.print_id }))
    .filter((r) => r.print_id)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizeStructures(data: AmendmentInput) {
  return data.structures
    .map((r) => ({ structure_id: r.structure_id }))
    .filter((r) => r.structure_id)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizeCombos(data: AmendmentInput) {
  return data.combos
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style: clean(r.style),
      article_no: clean(r.article_no),
    }))
    .filter((r) => r.style_ref_no || r.style || r.article_no)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizePriceDetails(data: AmendmentInput) {
  return data.price_details
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style: clean(r.style),
      article_no: clean(r.article_no),
      price_type: clean(r.price_type),
      unit: clean(r.unit),
      price: Number(r.price) || 0,
    }))
    .filter(
      (r) =>
        r.style_ref_no ||
        r.style ||
        r.article_no ||
        r.price_type ||
        r.unit ||
        r.price,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizeApprovalQtys(data: AmendmentInput) {
  return data.approval_qtys
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style: clean(r.style),
      article_no: clean(r.article_no),
      approval_qty: Number(r.approval_qty) || 0,
    }))
    .filter((r) => r.style_ref_no || r.style || r.article_no || r.approval_qty)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizeCountrySizes(data: AmendmentInput) {
  return data.country_sizes
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style: clean(r.style),
      article_no: clean(r.article_no),
      countrywise: !!r.countrywise,
    }))
    .filter((r) => r.style_ref_no || r.style || r.article_no || r.countrywise)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/** Replace every child grid wholesale for a given amendment id. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: AmendmentInput,
): Promise<Result> {
  const inserts: [string, Record<string, unknown>[]][] = [
    ["garment_order_amendment_charges", normalizeCharges(data)],
    ["garment_order_amendment_style_prices", normalizeStylePrices(data)],
    ["garment_order_amendment_styles", normalizeStyles(data)],
    ["garment_order_amendment_dyeings", normalizeDyeings(data)],
    ["garment_order_amendment_prints", normalizePrints(data)],
    ["garment_order_amendment_structures", normalizeStructures(data)],
    ["garment_order_amendment_combos", normalizeCombos(data)],
    ["garment_order_amendment_price_details", normalizePriceDetails(data)],
    ["garment_order_amendment_approval_qtys", normalizeApprovalQtys(data)],
    ["garment_order_amendment_country_sizes", normalizeCountrySizes(data)],
  ];

  // Delete-all-then-reinsert each child grid wholesale.
  for (const [t] of inserts) {
    const { error } = await s.from(t).delete().eq("amendment_id", amendmentId);
    if (error) return fail(error.message);
  }

  for (const [table, rows] of inserts) {
    if (!rows.length) continue;
    const { error } = await s
      .from(table)
      .insert(rows.map((r) => ({ ...r, amendment_id: amendmentId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

/** Strip child arrays so only header columns hit garment_order_amendments. */
function headerOnly(data: AmendmentInput) {
  const {
    charges: _c,
    style_prices: _p,
    styles: _st,
    dyeings: _dy,
    prints: _pr,
    structures: _sc,
    combos: _cb,
    price_details: _pd,
    approval_qtys: _aq,
    country_sizes: _cs,
    ...header
  } = data;
  void _c;
  void _p;
  void _st;
  void _dy;
  void _pr;
  void _sc;
  void _cb;
  void _pd;
  void _aq;
  void _cs;
  return header;
}

export async function createAmendment(data: AmendmentInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = amendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("garment_order_amendments")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create amendment");
  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_order_amendment.created",
    entityType: "garment_order_amendment",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateAmendment(
  id: string,
  data: AmendmentInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = amendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s
    .from("garment_order_amendments")
    .update(headerOnly(p.data))
    .eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_order_amendment.updated",
    entityType: "garment_order_amendment",
    entityId: id,
  });
  rev();
  return { ok: true };
}

export async function deleteAmendment(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s
    .from("garment_order_amendments")
    .delete()
    .eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
