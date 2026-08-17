"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { fabricBomInput, type FabricBomInput } from "./types";
import { getOrderFabricSeed, getOrderProduction } from "./service";
import type { OrderFabricSeedRow } from "./types";
import {
  fabricBasisOf,
  fabricRequirementRows,
  isRefusal,
  type FabricBasis,
} from "./requirement";
import {
  basisFingerprint,
  totalProductionOf,
  isRefusal as isOrderRefusal,
  type OrderProductionInput,
} from "@/lib/orders/material-bom/requirement";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/**
 * The routes a saved fabric BOM changes.
 *
 * Four, for the reason the Material BOM's `rev()` gives: the BOM's state is a
 * COLUMN on screens that are not this one, so leaving them stale means saving a
 * BOM does not change the badge the operator is looking at. `/orders/setup` is
 * here and not on the Material side because the hub carries a per-card count.
 */
function rev(): void {
  revalidatePath("/orders/fabric-bom");
  revalidatePath("/orders/amendments");
  revalidatePath("/orders/garment-orders");
  revalidatePath("/orders/setup");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------------------
// Normalising the lines
// ---------------------------------------------------------------------------

type LineRow = ReturnType<typeof normalizeLines>[number];
type LineRowWithId = LineRow & { id: string };

/**
 * Drop the rows that are only scaffolding, and renumber.
 *
 * A ROW IS EMPTY WHEN IT NAMES NO FABRIC AND CARRIES NO CONSUMPTION. Not "every
 * field is blank": a seeded row arrives with a combo, a structure and a
 * component already filled in from the order, so an all-blank test would keep
 * every seeded row the operator chose not to use — and each of those would then
 * refuse for want of a consumption, filling the Calculated Quantities section
 * with rows the operator deliberately left alone.
 */
function normalizeLines(data: FabricBomInput) {
  return data.lines
    .map((c) => ({
      style_ref_no: clean(c.style_ref_no),
      combo: clean(c.combo),
      structure_id: c.structure_id ?? null,
      component_id: c.component_id ?? null,
      item_id: c.item_id ?? null,
      fabric_type: clean(c.fabric_type),
      color_name: clean(c.color_name),
      consumption: c.consumption ?? null,
      consumption_uom_id: c.consumption_uom_id ?? null,
      wastage_pct: c.wastage_pct ?? 0,
      requirement_basis: c.requirement_basis ?? null,
      dia: c.dia ?? null,
      required_by: clean(c.required_by),
      rate: c.rate ?? null,
      notes: clean(c.notes),
      sno: 0,
    }))
    .filter((c) => c.item_id !== null || c.consumption != null)
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

// ---------------------------------------------------------------------------
// The stored requirement
// ---------------------------------------------------------------------------

/**
 * The requirement rows a saved BOM's lines explode into.
 *
 * EVERY LINE PRODUCES AT LEAST ONE ROW, including a refused one. A line that
 * simply produced nothing would leave the document with fewer rows than the
 * operator expects and no statement of why — and "fewer rows" is the shape a
 * short order takes, so it reads as an answer. The `chk_ofbr_answer_or_reason`
 * constraint (0426) is the database saying the same thing: a row either carries
 * a quantity or carries the sentence explaining its absence, never neither.
 */
function requirementRows(
  lines: LineRowWithId[],
  order: OrderProductionInput,
  uomDecimals: Map<string, number | null>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let sno = 0;

  for (const line of lines) {
    // A line with no fabric is scaffolding, not a requirement.
    if (!line.item_id) continue;

    const common = {
      line_id: line.id,
      item_id: line.item_id,
      style_ref_no: line.style_ref_no,
      consumption: line.consumption ?? 0,
      wastage_pct: line.wastage_pct ?? 0,
      consumption_uom_id: line.consumption_uom_id,
    };

    const basis = fabricBasisOf(line.requirement_basis);
    if (isRefusal(basis)) {
      out.push({
        ...common,
        sno: ++sno,
        // `basis` is NOT NULL with a CHECK, so a refused row still has to name
        // one. 'colour' is the neutral choice: it is what the operator will
        // almost certainly pick, and the row carries `required_qty` NULL, so
        // nothing reads the value as a claim about how the line splits.
        basis: "colour",
        combo: line.combo,
        size_id: null,
        slice_label: "—",
        basis_qty: 0,
        required_qty: null,
        refusal_reason: basis.refused,
      });
      continue;
    }

    const rows = fabricRequirementRows(
      basis as FabricBasis,
      { style_ref_no: line.style_ref_no, combo: line.combo },
      {
        consumption: line.consumption,
        wastage_pct: line.wastage_pct,
        decimals: line.consumption_uom_id
          ? (uomDecimals.get(line.consumption_uom_id) ?? null)
          : null,
      },
      order,
    );

    if (isRefusal(rows)) {
      // ONE row carrying the refusal, so the document states WHY.
      out.push({
        ...common,
        sno: ++sno,
        basis,
        combo: line.combo,
        size_id: null,
        slice_label: "—",
        basis_qty: 0,
        required_qty: null,
        refusal_reason: rows.refused,
      });
      continue;
    }

    for (const r of rows) {
      out.push({
        ...common,
        sno: ++sno,
        basis,
        // The SLICE's keys, not the line's. A line scoped to every colourway
        // produces a row per colour, and each has to say which one it is or the
        // unique index (`uq_ofbr_slice`) would see one line's rows as duplicates
        // of each other and reject the second.
        style_ref_no: r.style_ref_no,
        combo: r.combo,
        size_id: r.size_id,
        slice_label: r.label,
        basis_qty: r.qty,
        required_qty: r.required,
        refusal_reason: null,
      });
    }
  }
  return out;
}

async function uomDecimalMap(
  s: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, number | null>> {
  const { data } = await s.from("uoms").select("id, decimal_places_allowed");
  return new Map(
    ((data ?? []) as { id: string; decimal_places_allowed: number | null }[]).map((r) => [
      r.id,
      r.decimal_places_allowed,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function headerOnly(data: FabricBomInput, order: OrderProductionInput | null) {
  const total = order ? totalProductionOf(order) : null;
  return {
    garment_order_id: data.garment_order_id,
    bom_date: data.bom_date,
    is_draft: data.is_draft,
    remark: clean(data.remark),
    // Stamped in the SAME write as the rows it describes. A hash written at a
    // different moment from the requirement it fingerprints is a staleness check
    // that can be wrong in both directions.
    computed_at: order ? new Date().toISOString() : null,
    computed_for_qty: total != null && !isOrderRefusal(total) ? total : null,
    computed_basis_hash: order ? basisFingerprint(order) : null,
  };
}

async function writeLines(
  s: Awaited<ReturnType<typeof createClient>>,
  bomId: string,
  data: FabricBomInput,
  order: OrderProductionInput | null,
): Promise<Result> {
  // Requirements first: they reference the lines, so deleting the other way
  // round leaves the cascade to do it and the order of two deletes becomes a
  // thing to remember rather than a thing to read.
  for (const t of ["order_fabric_bom_requirements", "order_fabric_bom_lines"]) {
    const { error } = await s.from(t).delete().eq("bom_id", bomId);
    if (error) return fail(error.message);
  }

  const lines = normalizeLines(data);
  let saved: LineRowWithId[] = [];
  if (lines.length) {
    const { data: inserted, error } = await s
      .from("order_fabric_bom_lines")
      .insert(lines.map((r) => ({ ...r, bom_id: bomId })))
      .select("id, sno");
    if (error) return fail(error.message);
    // Match ids back by `sno`, which `normalizeLines` has just made unique and
    // dense. `.select()` does not promise insertion order.
    const bySno = new Map(
      ((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]),
    );
    saved = lines.map((r) => ({ ...r, id: bySno.get(r.sno) as string }));
    if (saved.some((r) => !r.id)) return fail("Could not read back the saved fabric lines");
  }

  if (order && saved.length) {
    const decimals = await uomDecimalMap(s);
    const rows = requirementRows(saved, order, decimals);
    if (rows.length) {
      const { error } = await s
        .from("order_fabric_bom_requirements")
        .insert(rows.map((r) => ({ ...r, bom_id: bomId })));
      if (error) return fail(error.message);
    }
  }

  return { ok: true };
}

export async function createFabricBom(data: FabricBomInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = fabricBomInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const order = await getOrderProduction(p.data.garment_order_id);

  const { data: created, error } = await s
    .from("order_fabric_boms")
    .insert(headerOnly(p.data, order))
    .select("id")
    .single();
  if (error || !created) {
    // ONE BOM PER ORDER IS A CONSTRAINT (`uq_order_fabric_bom_order`, 0426), so
    // this is the ordinary race and the ordinary second click, not a bug. Say
    // what happened in the operator's words — a raw unique-violation string
    // names an index nobody outside this file has heard of.
    return fail(
      error?.code === "23505"
        ? "This order already has a fabric BOM — open it from the queue instead"
        : (error?.message ?? "Failed to create the fabric BOM"),
    );
  }

  const childRes = await writeLines(s, created.id, p.data, order);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_fabric_bom.created",
    entityType: "order_fabric_bom",
    entityId: created.id,
  });
  rev();
  return { ok: true, id: created.id };
}

export async function updateFabricBom(id: string, data: FabricBomInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = fabricBomInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const order = await getOrderProduction(p.data.garment_order_id);

  const { error } = await s.from("order_fabric_boms").update(headerOnly(p.data, order)).eq("id", id);
  if (error) return fail(error.message);

  const childRes = await writeLines(s, id, p.data, order);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_fabric_bom.updated",
    entityType: "order_fabric_bom",
    entityId: id,
  });
  rev();
  return { ok: true, id };
}

export async function deleteFabricBom(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("order_fabric_boms").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// What the editor asks the server for while it is open
// ---------------------------------------------------------------------------

export type OrderProductionResult =
  | { ok: true; order: OrderProductionInput }
  | { ok: false; error: string };

/**
 * The picked order's Approval Qty, Combos and Assort rows, so the requirement
 * recalculates as the operator types.
 *
 * One round trip per ORDER, not per keystroke: the line changes while the
 * operator works and the order's quantities do not.
 */
export async function loadOrderProduction(
  garmentOrderId: string,
): Promise<OrderProductionResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const order = await getOrderProduction(garmentOrderId);
  return order
    ? { ok: true, order }
    : { ok: false, error: "That order could not be read" };
}

export type OrderFabricSeedResult =
  | { ok: true; rows: OrderFabricSeedRow[] }
  | { ok: false; error: string };

/**
 * The order's own Combos ▸ Detail tree, flattened into candidate BOM lines.
 *
 * A SERVER ACTION AND NOT PART OF THE FORM DATA, because it is per-order and the
 * form data is loaded once for the screen. Shipping every confirmed order's
 * fabric tree to the browser to use one of them is the payload the Material BOM
 * already declines to send for its own order production.
 */
export async function loadOrderFabricSeed(
  garmentOrderId: string,
): Promise<OrderFabricSeedResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const rows = await getOrderFabricSeed(garmentOrderId);
  return rows.length > 0
    ? { ok: true, rows }
    : {
        ok: false,
        // EMPTY-AND-EXPLAIN. An order with no fabric tree is a real state — the
        // Combos tab was left blank — and a seed button that silently adds
        // nothing looks broken rather than informative.
        error: "This order's Combos tab names no fabric structures yet",
      };
}
