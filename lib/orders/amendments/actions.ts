"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { amendmentInput, type AmendmentInput } from "./types";
import {
  seedAmendmentFromOrder,
  type SeededAmendmentChildren,
} from "./order-seed";

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


/**
 * Pack type(s) (0399) — the one child whose row IS its value.
 *
 * DE-DUPLICATES, which no sibling normalizer has to: every other grid keys on a
 * style and two lines about one style are two different facts, whereas naming
 * the same packing method twice says nothing the first row did not. The grid
 * already hides a method another row took, so this catches the paths that do
 * not go through the grid — `lib/data-io`, and a document saved before the
 * unique index existed.
 *
 * Case-insensitively, because "already saved" is the case that matters here:
 * the tuple's wording is Title Case, and a row imported in CAPS is the same
 * method. The FIRST spelling wins and is what is stored, so nothing is rewritten
 * behind the operator's back.
 */
function normalizePackTypes(data: AmendmentInput) {
  const seen = new Set<string>();
  return data.pack_types
    .map((r) => ({ pack_type: clean(r.pack_type) }))
    .filter((r) => r.pack_type)
    .filter((r) => {
      const k = r.pack_type!.toUpperCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizeQuantities(data: AmendmentInput) {
  return data.quantities
    .map((r) => ({
      country_id: r.country_id ?? null,
      style_ref_no: clean(r.style_ref_no),
      style_no: clean(r.style_no),
      consignee_id: r.consignee_id ?? null,
      assortment_type_id: r.assortment_type_id ?? null,
      po_qty: Number(r.po_qty) || 0,
      delivery_date: clean(r.delivery_date),
      earlier_shipment_date: clean(r.earlier_shipment_date),
      warehouse_id: r.warehouse_id ?? null,
      discharge_port_id: r.discharge_port_id ?? null,
    }))
    // A row the grid seeded and nobody answered is not a quantity. Same shape as
    // every sibling normalizer: drop the empty ones, then renumber so `sno` is
    // dense whatever the operator deleted.
    .filter(
      (r) =>
        r.country_id ||
        r.style_ref_no ||
        r.style_no ||
        r.consignee_id ||
        r.assortment_type_id ||
        r.po_qty ||
        r.delivery_date ||
        r.earlier_shipment_date ||
        r.warehouse_id ||
        r.discharge_port_id,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/** Replace every child grid wholesale for a given amendment id. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: AmendmentInput,
): Promise<Result> {
  /**
   * `garment_order_amendment_charges` is deliberately ABSENT (2026-08-10).
   *
   * The delete loop below iterates THIS list, so dropping an entry removes the
   * table from both halves: the stored charge rows are neither rewritten nor
   * deleted, they are simply left alone. Putting it back in the list while the
   * form no longer collects charges would wipe every amendment's charges on its
   * next save.
   */
  const inserts: [string, Record<string, unknown>[]][] = [
    ["garment_order_amendment_style_prices", normalizeStylePrices(data)],
    ["garment_order_amendment_styles", normalizeStyles(data)],
    ["garment_order_amendment_dyeings", normalizeDyeings(data)],
    ["garment_order_amendment_prints", normalizePrints(data)],
    ["garment_order_amendment_structures", normalizeStructures(data)],
    ["garment_order_amendment_combos", normalizeCombos(data)],
    ["garment_order_amendment_price_details", normalizePriceDetails(data)],
    ["garment_order_amendment_approval_qtys", normalizeApprovalQtys(data)],
    ["garment_order_amendment_pack_types", normalizePackTypes(data)],
    // THIS LIST DRIVES THE DELETE LOOP AS WELL AS THE INSERTS. An entry added
    // only to the insert side would leave the previous rows in place and add
    // the new ones beside them, doubling the grid on every save.
    ["garment_order_amendment_quantities", normalizeQuantities(data)],
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
    style_prices: _p,
    styles: _st,
    dyeings: _dy,
    prints: _pr,
    structures: _sc,
    combos: _cb,
    price_details: _pd,
    approval_qtys: _aq,
    pack_types: _pt,
    quantities: _qt,
    // NOT A COLUMN HERE. `location_id` belongs to the `sales_orders` row this
    // document mints its SC No from; leaving it in the spread would send
    // PostgREST a column `garment_order_amendments` does not have.
    location_id: _loc,
    ...header
  } = data;
  void _loc;
  void _p;
  void _st;
  void _dy;
  void _pr;
  void _sc;
  void _cb;
  void _pd;
  void _aq;
  void _pt;
  void _qt;
  return header;
}

export async function createAmendment(data: AmendmentInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = amendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();

  /**
   * MINT THE SC NO (client 2026-08-11).
   *
   * The SC No lives on `sales_orders.order_number` and is stamped by 0395's
   * `assign_order_number()` BEFORE INSERT trigger — the ONLY authority for it,
   * because the format and the April–March fiscal-year rule live in
   * `sales_order_no_format()` / `fiscal_year_segment()` and a second
   * implementation here would drift the moment either changed.
   *
   * So the order row is created first and its id becomes `sales_order_id`. A
   * document that already names one (an edit re-submitted, or a record made
   * while SCNo was still a picker) is left alone — this never re-numbers.
   *
   * NOT ATOMIC: two PostgREST calls, no transaction. If the document insert
   * below fails we delete the order we just made, so a failed save cannot leave
   * a numbered order with nothing attached. The COUNTER is not rolled back and
   * that is deliberate — 0395's rule is that gaps are cheaper than duplicates.
   * The correct end state is one plpgsql RPC doing both inserts; this is the
   * honest version until there is one.
   */
  let salesOrderId = p.data.sales_order_id;
  let mintedOrderId: string | null = null;
  if (!salesOrderId) {
    // The Unit is only mandatory on THIS branch — it is what the counter is
    // keyed by. Checked here rather than in the schema so an edit of a document
    // whose order predates per-location numbering stays saveable; see the note
    // on `location_id` in types.ts.
    if (!p.data.location_id) {
      return fail("Unit is required — the SC No is numbered under it.");
    }
    const { data: order, error: orderErr } = await s
      .from("sales_orders")
      .insert({
        buyer_id: p.data.buyer_id,
        location_id: p.data.location_id,
        // Decides which fiscal year the SC No numbers into, so a back-dated
        // order files under the previous year. Sent explicitly: what the
        // operator saw in the header must be what the number is built from.
        order_date: p.data.amend_date,
        currency_code: p.data.currency_code,
        ship_date: p.data.delivery_date,
        // Spread, not `merchandiser_id: … ?? null`. The column defaults to
        // `auth.uid()`, and PostgREST applies a default only for an ABSENT key —
        // sending an explicit null would override it and leave the order with no
        // merchandiser whenever the operator named none.
        ...(p.data.merchandiser_id ? { merchandiser_id: p.data.merchandiser_id } : {}),
      })
      .select("id")
      .single();
    if (orderErr || !order) {
      return fail(orderErr?.message ?? "Could not create the order number");
    }
    salesOrderId = order.id;
    mintedOrderId = order.id;
  }

  const { data: created, error } = await s
    .from("garment_order_amendments")
    .insert({ ...headerOnly(p.data), sales_order_id: salesOrderId })
    .select("id")
    .single();
  if (error || !created) {
    if (mintedOrderId) await s.from("sales_orders").delete().eq("id", mintedOrderId);
    return fail(error?.message ?? "Failed to create garment order");
  }
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
  /**
   * NEVER BLANK THE ORDER LINK. `sales_order_id` is nullable on input because a
   * CREATE cannot supply it (the SC No does not exist yet) — but an update
   * carrying null would clear a stored FK and orphan the document from its own
   * number. Drop the key rather than send it.
   */
  const { sales_order_id, ...patch } = headerOnly(p.data);
  const { error } = await s
    .from("garment_order_amendments")
    .update(sales_order_id ? { ...patch, sales_order_id } : patch)
    .eq("id", id);
  if (error) return fail(error.message);

  /**
   * Mirror the few header fields `sales_orders` also holds, or All Orders shows
   * a buyer and a ship date the document no longer agrees with. Deliberately
   * short, and it never touches `location_id`, `order_date` or `order_number` —
   * all three feed the minted SC No, and re-numbering a saved order is not a
   * thing this screen may do.
   */
  if (sales_order_id) {
    await s
      .from("sales_orders")
      .update({
        buyer_id: p.data.buyer_id,
        currency_code: p.data.currency_code,
        ship_date: p.data.delivery_date,
        merchandiser_id: p.data.merchandiser_id,
      })
      .eq("id", sales_order_id);
  }

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

/**
 * Read the order the operator just picked and shape it into the eight child
 * tabs, so the amendment starts as the order STANDS and they edit the deltas.
 *
 * A separate action rather than part of `getAmendmentFormData` because it is
 * per-order and on-demand — seeding every order's children into the initial
 * page payload would load the whole Orders module to fill one screen.
 *
 * Reads only: gated on `view`, and no `rev()` — there is nothing to revalidate.
 */
export type SeedResult =
  | { ok: true; seed: SeededAmendmentChildren }
  | { ok: false; error: string };

// `fail()` returns the write-side `Result`, whose success branch carries no
// payload — reusing it here would not narrow to the error case.
const seedFail = (error: string): SeedResult => ({ ok: false, error });

export async function loadOrderSeed(salesOrderId: string): Promise<SeedResult> {
  if (!(await can("orders", "view"))) return seedFail("Forbidden");
  if (!salesOrderId) return seedFail("No order selected");
  try {
    return { ok: true, seed: await seedAmendmentFromOrder(salesOrderId) };
  } catch (e) {
    // The screen leaves the tabs untouched on a failure rather than half-filling
    // them, so the message is the only signal the operator gets.
    return seedFail(e instanceof Error ? e.message : "Could not read the order");
  }
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
