"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { materialInput, type MaterialInput } from "./material-types";

type Result = { ok: true } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/materials");
}
function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/** Header row for `items` (everything except the two child grids). */
function toHeader(d: MaterialInput) {
  const { mixings: _m, conversions: _c, ...rest } = d;
  void _m;
  void _c;
  return {
    ...rest,
    name: (d.name?.trim() || d.code.trim()) as string, // Name falls back to Short Name
    hsn_code: d.hsn_code?.trim() || null,
    material_type: d.material_type?.trim() || null,
    specifications: d.specifications?.trim() || null,
    short_spec: d.short_spec?.trim() || null,
    shade: d.shade?.trim() || null,
  };
}

function normMixings(d: MaterialInput) {
  return d.mixings
    .filter((m) => (m.description?.trim() || m.shade?.trim() || m.uom_id))
    .map((m, i) => ({
      sno: i + 1,
      description: m.description?.trim() || null,
      shade: m.shade?.trim() || null,
      uom_id: m.uom_id,
    }));
}
function normConversions(d: MaterialInput) {
  return d.conversions
    .filter((c) => c.alt_uom_id || c.base_uom_id || c.alt_qty != null || c.base_qty != null)
    .map((c, i) => ({
      sno: i + 1,
      alt_qty: c.alt_qty,
      alt_uom_id: c.alt_uom_id,
      base_qty: c.base_qty,
      base_uom_id: c.base_uom_id,
    }));
}

export async function createMaterial(data: MaterialInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = materialInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s.from("items").insert(toHeader(p.data)).select("id").single();
  if (error) return fail(error.message);
  const mx = normMixings(p.data);
  if (mx.length) {
    const { error: e } = await s.from("material_mixings").insert(mx.map((r) => ({ ...r, item_id: created.id })));
    if (e) return fail(e.message);
  }
  const cv = normConversions(p.data);
  if (cv.length) {
    const { error: e } = await s.from("material_uom_conversions").insert(cv.map((r) => ({ ...r, item_id: created.id })));
    if (e) return fail(e.message);
  }
  rev();
  return { ok: true };
}

export async function updateMaterial(id: string, data: MaterialInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = materialInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("items").update(toHeader(p.data)).eq("id", id);
  if (error) return fail(error.message);
  // Replace both child grids wholesale.
  const d1 = await s.from("material_mixings").delete().eq("item_id", id);
  if (d1.error) return fail(d1.error.message);
  const d2 = await s.from("material_uom_conversions").delete().eq("item_id", id);
  if (d2.error) return fail(d2.error.message);
  const mx = normMixings(p.data);
  if (mx.length) {
    const { error: e } = await s.from("material_mixings").insert(mx.map((r) => ({ ...r, item_id: id })));
    if (e) return fail(e.message);
  }
  const cv = normConversions(p.data);
  if (cv.length) {
    const { error: e } = await s.from("material_uom_conversions").insert(cv.map((r) => ({ ...r, item_id: id })));
    if (e) return fail(e.message);
  }
  rev();
  return { ok: true };
}

export async function deleteMaterial(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("items").delete().eq("id", id); // grids cascade; FK-in-use → clear error
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
