"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  materialBomAmendmentInput,
  type MaterialBomAmendmentInput,
  type MbaItemInput,
  type BomCopyPayload,
} from "./types";
import { getOrderProduction } from "./service";
import {
  basisFingerprint,
  isRefusal,
  productionSlices,
  requirementFor,
  totalProductionOf,
  type OrderProductionInput,
  type RequirementBasis,
} from "@/lib/orders/material-bom/requirement";
import { isUsableConversion, toPurchaseQty, uomPrecision } from "@/lib/uom/convert";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/**
 * Four routes, because the BOM's status is shown on two screens that are not
 * this one. `/orders/amendments` and `/orders/garment-orders` are the two doors
 * onto the Garment Order list, which carries the "Material BOM" column; leaving
 * either stale means saving a BOM does not change the badge the operator is
 * looking at.
 */
function rev(): void {
  revalidatePath("/orders/material-bom");
  revalidatePath("/orders/amendments");
  revalidatePath("/orders/garment-orders");
  revalidatePath("/orders/all");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const numOrNull = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// ---------------------------------------------------------------------------
// Child normalizers (drop fully-empty rows + renumber sno)
// ---------------------------------------------------------------------------

function normalizeItems(data: MaterialBomAmendmentInput) {
  return data.items
    .map((c) => ({
      category_id: c.category_id ?? null,
      type: clean(c.type),
      item_id: c.item_id ?? null,
      attribute_id: c.attribute_id ?? null,
      item_color_id: c.item_color_id ?? null,
      specification: clean(c.specification),
      size: clean(c.size),
      requirement_basis: c.requirement_basis ?? null,
      style_ref_no: clean(c.style_ref_no),
      // 0423's column. It was declared on the table, offered by the grid and
      // accepted by `mbaItemInput`, and then dropped HERE — this literal names
      // every column it writes, so an omission is silent: the operator picked a
      // panel, saved, and reopened the line to find it blank. Not a null being
      // written over a value; the value never left the browser.
      component_id: c.component_id ?? null,
      supply_type: clean(c.supply_type),
      vendor_id: c.vendor_id ?? null,
      purchase_uom_id: c.purchase_uom_id ?? null,
      consumption_uom_id: c.consumption_uom_id ?? null,
      alternate_uom_id: c.alternate_uom_id ?? null,
      uom_conversion_id: c.uom_conversion_id ?? null,
      combination: clean(c.combination),
      moq: c.moq ?? null,
      no_of_items: c.no_of_items ?? null,
      per_pieces: c.per_pieces ?? null,
      excess_pct: c.excess_pct ?? 0,
      required_by: clean(c.required_by),
    }))
    .filter(
      (c) =>
        c.category_id ||
        c.type ||
        c.item_id ||
        c.attribute_id ||
        c.item_color_id ||
        c.specification ||
        c.size ||
        c.requirement_basis ||
        c.supply_type ||
        c.vendor_id ||
        c.purchase_uom_id ||
        c.consumption_uom_id ||
        c.alternate_uom_id ||
        c.uom_conversion_id ||
        c.combination ||
        c.moq != null ||
        c.no_of_items != null ||
        c.per_pieces != null,
    )
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

function normalizeProcesses(data: MaterialBomAmendmentInput) {
  return data.processes
    .filter((p) => p.item_id || p.process_id || p.vendor_id || p.qty_out != null)
    .map((p, i) => ({
      item_id: p.item_id ?? null,
      process_id: p.process_id ?? null,
      vendor_id: p.vendor_id ?? null,
      qty_out: p.qty_out ?? null,
      qty_in: p.qty_in ?? null,
      status: p.status ?? "planned",
      sno: i + 1,
    }));
}

// ---------------------------------------------------------------------------
// The requirement, computed on the SERVER
// ---------------------------------------------------------------------------

type ConversionRow = {
  id: string;
  alt_qty: number | null;
  alt_uom_id: string | null;
  base_qty: number | null;
  base_uom_id: string | null;
};

/** A material's pack sizes and the UOM precisions, for the purchase quantity. */
type PackContext = {
  conversions: Map<string, ConversionRow>;
  uomDecimals: Map<string, number | null>;
};

async function packContext(s: Awaited<ReturnType<typeof createClient>>): Promise<PackContext> {
  const [conv, uoms] = await Promise.all([
    s.from("material_uom_conversions").select("id, alt_qty, alt_uom_id, base_qty, base_uom_id"),
    s.from("uoms").select("id, decimal_places_allowed"),
  ]);
  return {
    conversions: new Map(((conv.data ?? []) as ConversionRow[]).map((c) => [c.id, c])),
    uomDecimals: new Map(
      ((uoms.data ?? []) as { id: string; decimal_places_allowed: number | null }[]).map((u) => [
        u.id,
        u.decimal_places_allowed,
      ]),
    ),
  };
}

type ItemRowWithId = ReturnType<typeof normalizeItems>[number] & { id: string };

/**
 * Explode every saved BOM line into its requirement rows.
 *
 * COMPUTED HERE, FROM THE ORDER READ BACK OUT OF THE DATABASE — never from the
 * form. Same argument 0413 makes for reading rejection tiers server-side: a
 * stale tab must not be able to store a quantity no order ever produced. The
 * screen runs the identical functions so what the operator approved and what is
 * stored cannot differ, but the stored copy is the one computed from the truth.
 *
 * A REFUSAL IS A ROW, not a gap. `required_qty` NULL plus `refusal_reason` means
 * anyone reading the document later — a buyer, an auditor, the next
 * merchandiser — sees which question was unanswered. Dropping refused lines
 * would leave a BOM that looks complete and buys short.
 */
function requirementRows(
  items: ItemRowWithId[],
  order: OrderProductionInput,
  packs: PackContext,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let sno = 0;

  for (const line of items) {
    // A line with no material is scaffolding, not a requirement.
    if (!line.item_id) continue;

    const basis = line.requirement_basis as RequirementBasis | null;
    const common = {
      item_line_id: line.id,
      item_id: line.item_id,
      style_ref_no: line.style_ref_no,
      no_of_items: line.no_of_items ?? 0,
      per_pieces: line.per_pieces ?? 0,
      excess_pct: line.excess_pct ?? 0,
      consumption_uom_id: line.consumption_uom_id,
      uom_conversion_id: line.uom_conversion_id,
      purchase_uom_id: line.purchase_uom_id,
    };

    if (!basis) {
      out.push({
        ...common,
        sno: ++sno,
        basis: "order",
        combo: null,
        size_id: null,
        slice_label: "Whole order",
        basis_qty: 0,
        required_qty: null,
        refusal_reason: "Choose how this material splits",
        purchase_qty: null,
      });
      continue;
    }

    const slices = productionSlices(basis, order);
    if (isRefusal(slices)) {
      // One row carrying the refusal, so the document states WHY rather than
      // simply having fewer rows than the operator expects.
      out.push({
        ...common,
        sno: ++sno,
        basis,
        combo: null,
        size_id: null,
        slice_label: "—",
        basis_qty: 0,
        required_qty: null,
        refusal_reason: slices.refused,
        purchase_qty: null,
      });
      continue;
    }

    const conv = line.uom_conversion_id
      ? (packs.conversions.get(line.uom_conversion_id) ?? null)
      : null;
    // The pack must convert INTO the unit this line is consumed in. A cone that
    // holds metres against a line counted in pieces yields a number and a
    // category error; nothing in the codebase checked this before.
    const packUsable =
      !!conv &&
      isUsableConversion(conv) &&
      (!line.consumption_uom_id || conv.base_uom_id === line.consumption_uom_id);

    for (const slice of slices) {
      const value = requirementFor(
        {
          no_of_items: line.no_of_items,
          per_pieces: line.per_pieces,
          excess_pct: line.excess_pct,
          decimals: line.consumption_uom_id
            ? (packs.uomDecimals.get(line.consumption_uom_id) ?? null)
            : null,
        },
        slice,
      );

      const refused = isRefusal(value);
      const qty = refused ? null : value;

      out.push({
        ...common,
        sno: ++sno,
        basis,
        // The slice's own style wins: a line marked "every style" still produces
        // per-style rows when the order splits by colour.
        style_ref_no: slice.style_ref_no ?? line.style_ref_no,
        combo: slice.combo,
        size_id: slice.size_id,
        slice_label: slice.label,
        basis_qty: slice.qty,
        required_qty: qty,
        refusal_reason: refused ? value.refused : null,
        purchase_qty:
          qty != null && packUsable && conv
            ? toPurchaseQty(
                qty,
                conv,
                uomPrecision(
                  conv.alt_uom_id ? (packs.uomDecimals.get(conv.alt_uom_id) ?? null) : null,
                ),
              )
            : null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Replace every child grid wholesale for a given amendment id.
 *
 * `lib/orders/amendments/actions.ts` carries the standing warning that a table
 * added to the insert side but not the delete side doubles the grid on every
 * save. All three are deleted here, and the requirement rows are then rebuilt
 * from the items rather than from the form.
 *
 * ORDER MATTERS BOTH WAYS. Requirements are deleted FIRST because they hold an
 * FK to `material_bom_amendment_items` — deleting the items first cascades them
 * away mid-write — and inserted LAST because that FK needs the new line ids.
 */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: MaterialBomAmendmentInput,
  order: OrderProductionInput | null,
): Promise<Result> {
  for (const t of [
    "material_bom_amendment_requirements",
    "material_bom_amendment_items",
    "material_bom_amendment_processes",
  ]) {
    const { error } = await s.from(t).delete().eq("amendment_id", amendmentId);
    if (error) return fail(error.message);
  }

  const items = normalizeItems(data);
  let savedItems: ItemRowWithId[] = [];
  if (items.length) {
    const { data: inserted, error } = await s
      .from("material_bom_amendment_items")
      .insert(items.map((r) => ({ ...r, amendment_id: amendmentId })))
      .select("id, sno");
    if (error) return fail(error.message);
    // Match ids back by `sno`, which `normalizeItems` has just made unique and
    // dense. `.select()` does not promise insertion order.
    const bySno = new Map(
      ((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]),
    );
    savedItems = items.map((r) => ({ ...r, id: bySno.get(r.sno) as string }));
    if (savedItems.some((r) => !r.id)) return fail("Could not read back the saved BOM lines");
  }

  const processes = normalizeProcesses(data);
  if (processes.length) {
    const { error } = await s
      .from("material_bom_amendment_processes")
      .insert(processes.map((r) => ({ ...r, amendment_id: amendmentId })));
    if (error) return fail(error.message);
  }

  if (order && savedItems.length) {
    const packs = await packContext(s);
    const rows = requirementRows(savedItems, order, packs);
    if (rows.length) {
      const { error } = await s
        .from("material_bom_amendment_requirements")
        .insert(rows.map((r) => ({ ...r, amendment_id: amendmentId })));
      if (error) return fail(error.message);
    }
  }

  return { ok: true };
}

/** Strip child arrays so only header columns hit material_bom_amendments. */
function headerOnly(data: MaterialBomAmendmentInput, order: OrderProductionInput | null) {
  const total = order ? totalProductionOf(order) : null;
  return {
    garment_order_id: data.garment_order_id ?? null,
    customer_id: data.customer_id ?? null,
    amend_date: data.amend_date,
    is_draft: data.is_draft,
    remarks: clean(data.remarks),
    // Stamped in the same write as the rows they describe. A hash written at a
    // different moment from the requirement it fingerprints is a staleness check
    // that can be wrong in both directions.
    computed_at: order ? new Date().toISOString() : null,
    computed_for_qty: total != null && !isRefusal(total) ? total : null,
    computed_basis_hash: order ? basisFingerprint(order) : null,
  };
}

/** Next per-order amendment number (A. No). */
async function nextAmendmentNo(
  s: Awaited<ReturnType<typeof createClient>>,
  garmentOrderId: string | null,
): Promise<number> {
  if (!garmentOrderId) return 1;
  const { data } = await s
    .from("material_bom_amendments")
    .select("amendment_no")
    .eq("garment_order_id", garmentOrderId)
    .order("amendment_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.amendment_no as number | undefined) ?? 0) + 1;
}

export async function createMaterialBomAmendment(
  data: MaterialBomAmendmentInput,
): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = materialBomAmendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const order = p.data.garment_order_id
    ? await getOrderProduction(p.data.garment_order_id)
    : null;

  const amendment_no = await nextAmendmentNo(s, p.data.garment_order_id ?? null);
  const { data: created, error } = await s
    .from("material_bom_amendments")
    .insert({ ...headerOnly(p.data, order), amendment_no })
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create the material BOM");

  const childRes = await writeChildren(s, created.id, p.data, order);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "material_bom_amendment.created",
    entityType: "material_bom_amendment",
    entityId: created.id,
  });
  rev();
  return { ok: true, id: created.id };
}

export async function updateMaterialBomAmendment(
  id: string,
  data: MaterialBomAmendmentInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = materialBomAmendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const order = p.data.garment_order_id
    ? await getOrderProduction(p.data.garment_order_id)
    : null;

  const { error } = await s
    .from("material_bom_amendments")
    .update(headerOnly(p.data, order))
    .eq("id", id);
  if (error) return fail(error.message);

  const childRes = await writeChildren(s, id, p.data, order);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "material_bom_amendment.updated",
    entityType: "material_bom_amendment",
    entityId: id,
  });
  rev();
  return { ok: true, id };
}

export async function deleteMaterialBomAmendment(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("material_bom_amendments").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reading one order's production, for the editor
// ---------------------------------------------------------------------------

export type OrderProductionResult =
  | { ok: true; order: OrderProductionInput }
  | { ok: false; error: string };

/**
 * The picked order's Approval Qty, Combos and Assort rows, so the Requirement
 * tab can recalculate as the operator types.
 *
 * One round trip per ORDER, not per keystroke: the line changes while the
 * operator works, the order's quantities do not. Shipping every order's
 * production input with the form data was the alternative and grows with the
 * order book.
 */
export async function loadOrderProduction(
  garmentOrderId: string,
): Promise<OrderProductionResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  if (!garmentOrderId) return { ok: false, error: "No order selected" };
  try {
    const order = await getOrderProduction(garmentOrderId);
    if (!order) return { ok: false, error: "That order no longer exists" };
    return { ok: true, order };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the order" };
  }
}

// ---------------------------------------------------------------------------
// Copy from another order
// ---------------------------------------------------------------------------

export type CopyResult = { ok: true; payload: BomCopyPayload } | { ok: false; error: string };

/**
 * The item and process lines of another order's BOM, shaped for this form.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT CARRY.
 *
 * **Quantities.** Not the requirement rows, not `computed_for_qty` — nothing
 * derived. They recompute against THIS order's production target on save, which
 * is the entire reason copying is safe: what is copied is the RECIPE (which
 * materials, how many per garment, how they split), and the recipe is genuinely
 * order-independent.
 *
 * **A vendor from a different customer.** `customer_nominated_vendors` is a
 * CUSTOMER's list of who may supply them, so carrying a nomination across
 * customers names a vendor this customer never approved — precisely what
 * `nominatedVendorOptions()` exists to prevent, arriving by a side door that
 * never opens a picker. The sheet is told, rather than leaving it to be noticed
 * on the first purchase order.
 *
 * `required_by` and `style_ref_no` are dropped for the same reason quantities
 * are: they are a date and a style in the SOURCE order's world.
 */
export async function copyMaterialBomFrom(
  sourceBomId: string,
  targetCustomerId: string | null,
): Promise<CopyResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  if (!sourceBomId) return { ok: false, error: "No source chosen" };

  const s = await createClient();
  const { data, error } = await s
    .from("material_bom_amendments")
    .select(
      "id, customer_id, garment_order:garment_order_amendments(customer_id), " +
        "items:material_bom_amendment_items(*), " +
        "processes:material_bom_amendment_processes(*)",
    )
    .eq("id", sourceBomId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That material BOM no longer exists" };

  const row = data as unknown as {
    customer_id: string | null;
    garment_order: { customer_id: string | null } | null;
    items: Record<string, unknown>[] | null;
    processes: Record<string, unknown>[] | null;
  };

  const sourceCustomer = row.garment_order?.customer_id ?? row.customer_id ?? null;
  const sameCustomer = !!targetCustomerId && sourceCustomer === targetCustomerId;

  const sorted = [...(row.items ?? [])].sort(
    (a, b) => ((a.sno as number) ?? 0) - ((b.sno as number) ?? 0),
  );

  const items: Omit<MbaItemInput, "sno">[] = sorted.map((c) => ({
    category_id: (c.category_id as string) ?? null,
    type: (c.type as string) ?? null,
    item_id: (c.item_id as string) ?? null,
    attribute_id: (c.attribute_id as string) ?? null,
    // The trim's identity IS the recipe — a copied Main Label line is the same
    // woven 50mm black label. Only order-specific values are dropped.
    item_color_id: (c.item_color_id as string) ?? null,
    specification: (c.specification as string) ?? null,
    size: (c.size as string) ?? null,
    requirement_basis: (c.requirement_basis as RequirementBasis) ?? null,
    style_ref_no: null,
    // The PANEL goes with the style ref, and for the same reason (0423): a
    // component belongs to a style, the source order's styles are not this
    // order's, and the screen narrows the cell to the style the line names.
    // Carrying it would offer a sleeve this garment may not have.
    component_id: null,
    supply_type: (c.supply_type as string) ?? null,
    vendor_id: sameCustomer ? ((c.vendor_id as string) ?? null) : null,
    purchase_uom_id: (c.purchase_uom_id as string) ?? null,
    consumption_uom_id: (c.consumption_uom_id as string) ?? null,
    alternate_uom_id: (c.alternate_uom_id as string) ?? null,
    uom_conversion_id: (c.uom_conversion_id as string) ?? null,
    combination: (c.combination as string) ?? null,
    // THE PANELS CANNOT TRAVEL, for the same reason `component_id` and
    // `style_ref_no` below do not: a component belongs to a STYLE, and a source
    // order's styles are not this one's (0436). Copying them would point every
    // panel row at a style the target order has never heard of.
    components: [],
    moq: numOrNull(c.moq),
    no_of_items: numOrNull(c.no_of_items),
    per_pieces: numOrNull(c.per_pieces),
    excess_pct: numOrNull(c.excess_pct) ?? 0,
    required_by: null,
  }));

  const processes = [...(row.processes ?? [])]
    .sort((a, b) => ((a.sno as number) ?? 0) - ((b.sno as number) ?? 0))
    .map((p) => ({
      item_id: (p.item_id as string) ?? null,
      process_id: (p.process_id as string) ?? null,
      vendor_id: sameCustomer ? ((p.vendor_id as string) ?? null) : null,
      // Quantities sent and received belong to the source order's actual
      // movements. A copy is a plan, so it starts at 'planned' with nothing out.
      qty_out: null,
      qty_in: null,
      status: "planned" as const,
    }));

  const vendorsDropped =
    !sameCustomer &&
    ((row.items ?? []).some((c) => !!c.vendor_id) ||
      (row.processes ?? []).some((p) => !!p.vendor_id));

  return { ok: true, payload: { items, processes, vendorsDropped } };
}
