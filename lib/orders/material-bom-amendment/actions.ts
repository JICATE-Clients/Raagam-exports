"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  materialBomAmendmentInput,
  type MaterialBomAmendmentInput,
} from "./types";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/material-bom-amendment");
  revalidatePath("/orders");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------- child normalizers (drop fully-empty rows + renumber sno) ----------

function normalizeItems(data: MaterialBomAmendmentInput) {
  return data.items
    .map((c) => ({
      category_id: c.category_id ?? null,
      type: clean(c.type),
      item_id: c.item_id ?? null,
      attribute_id: c.attribute_id ?? null,
      supply_type: clean(c.supply_type),
      vendor_id: c.vendor_id ?? null,
      purchase_uom_id: c.purchase_uom_id ?? null,
      consumption_uom_id: c.consumption_uom_id ?? null,
      alternate_uom_id: c.alternate_uom_id ?? null,
      combination: clean(c.combination),
      moq: c.moq ?? null,
      quantity_nos: c.quantity_nos ?? null,
    }))
    .filter(
      (c) =>
        c.category_id ||
        c.type ||
        c.item_id ||
        c.attribute_id ||
        c.supply_type ||
        c.vendor_id ||
        c.purchase_uom_id ||
        c.consumption_uom_id ||
        c.alternate_uom_id ||
        c.combination ||
        c.moq != null ||
        c.quantity_nos != null,
    )
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

function normalizeProcesses(data: MaterialBomAmendmentInput) {
  return data.processes
    .filter((p) => !!p.item_id)
    .map((p, i) => ({ item_id: p.item_id as string, sno: i + 1 }));
}

/** Replace every child grid wholesale for a given amendment id. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: MaterialBomAmendmentInput,
): Promise<Result> {
  const tables = [
    "material_bom_amendment_items",
    "material_bom_amendment_processes",
  ];
  for (const t of tables) {
    const { error } = await s.from(t).delete().eq("amendment_id", amendmentId);
    if (error) return fail(error.message);
  }

  const inserts: [string, Record<string, unknown>[]][] = [
    ["material_bom_amendment_items", normalizeItems(data)],
    ["material_bom_amendment_processes", normalizeProcesses(data)],
  ];
  for (const [table, rows] of inserts) {
    if (!rows.length) continue;
    const { error } = await s
      .from(table)
      .insert(rows.map((r) => ({ ...r, amendment_id: amendmentId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

/** Strip child arrays so only header columns hit material_bom_amendments. */
function headerOnly(data: MaterialBomAmendmentInput) {
  const { items: _i, processes: _p, ...header } = data;
  void _i;
  void _p;
  return {
    sales_order_id: header.sales_order_id ?? null,
    customer_id: header.customer_id ?? null,
    amend_date: header.amend_date,
    is_draft: header.is_draft,
    remarks: clean(header.remarks),
  };
}

/** Next per-order amendment number (A. No). */
async function nextAmendmentNo(
  s: Awaited<ReturnType<typeof createClient>>,
  salesOrderId: string | null,
): Promise<number> {
  if (!salesOrderId) return 1;
  const { data } = await s
    .from("material_bom_amendments")
    .select("amendment_no")
    .eq("sales_order_id", salesOrderId)
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
  const amendment_no = await nextAmendmentNo(s, p.data.sales_order_id ?? null);
  const { data: created, error } = await s
    .from("material_bom_amendments")
    .insert({ ...headerOnly(p.data), amendment_no })
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create amendment");
  const childRes = await writeChildren(s, created.id, p.data);
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
  const { error } = await s
    .from("material_bom_amendments")
    .update(headerOnly(p.data))
    .eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, id, p.data);
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
