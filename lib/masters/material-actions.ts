"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { materialInput, type MaterialInput } from "./material-types";
import { deleteOrDeactivate } from "./delete-guard";
import { findDuplicateYarn } from "./material-service";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/materials");
}
function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

/** Header row for `items` (everything except the child grids). */
function toHeader(d: MaterialInput) {
  const { mixings: _m, conversions: _c, using_items: _u, ...rest } = d;
  void _m;
  void _c;
  void _u;
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
    .filter((m) => (m.description?.trim() || m.shade?.trim() || m.uom_id || m.component_item_id || m.blend_pct != null))
    .map((m, i) => ({
      sno: i + 1,
      description: m.description?.trim() || null,
      shade: m.shade?.trim() || null,
      uom_id: m.uom_id,
      component_item_id: m.component_item_id,
      count_id: m.count_id,
      blend_pct: m.blend_pct,
    }));
}

/** Resolve an item_class_id to its config_lookups code (server-verified, not
 *  trusted from the client) — scopes the Yarn duplicate guard and the Fabric
 *  mandatory-fabric_type check to the correct class regardless of what code
 *  the client sends. */
async function resolveItemClassCode(s: Awaited<ReturnType<typeof createClient>>, itemClassId: string | null): Promise<string | null> {
  if (!itemClassId) return null;
  const { data } = await s.from("config_lookups").select("code").eq("id", itemClassId).maybeSingle();
  return data?.code?.toUpperCase() ?? null;
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
function normUsingItems(d: MaterialInput) {
  return d.using_items
    .filter((u) => u.used_item_id || u.description?.trim() || u.shade?.trim() || u.uom_id)
    .map((u, i) => ({
      sno: i + 1,
      used_item_id: u.used_item_id,
      description: u.description?.trim() || null,
      shade: u.shade?.trim() || null,
      uom_id: u.uom_id,
    }));
}

export async function createMaterial(data: MaterialInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = materialInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const classCode = await resolveItemClassCode(s, p.data.item_class_id);
  const header = toHeader(p.data);
  if (classCode === "YARN") {
    const dup = await findDuplicateYarn(p.data.item_class_id as string, p.data.count_id, p.data.category_id, p.data.purity_id);
    if (dup) return fail(`A yarn with this Count/Category/Purity already exists: "${dup.name}". Select it instead of creating a duplicate.`);
  } else {
    const dup = await checkDuplicateName(s, "items", header.name, {
      scope: { item_class_id: p.data.item_class_id },
    });
    if (!dup.ok) return fail(dup.error);
  }
  const dupCode = await checkDuplicateName(s, "items", header.code, {
    nameColumn: "code",
    label: "code",
    scope: { item_class_id: p.data.item_class_id },
  });
  if (!dupCode.ok) return fail(dupCode.error);
  if (classCode === "FABRIC" && !p.data.fabric_type_id) {
    return fail("Fabric Type is required (Solid, Yarn-dyed or Melange) — it determines the dyeing PO type.");
  }
  const { data: created, error } = await s.from("items").insert(header).select("id").single();
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
  const ui = normUsingItems(p.data);
  if (ui.length) {
    const { error: e } = await s.from("material_using_items").insert(ui.map((r) => ({ ...r, item_id: created.id })));
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
  const classCode = await resolveItemClassCode(s, p.data.item_class_id);
  const header = toHeader(p.data);
  if (classCode === "YARN") {
    const dup = await findDuplicateYarn(p.data.item_class_id as string, p.data.count_id, p.data.category_id, p.data.purity_id, id);
    if (dup) return fail(`A yarn with this Count/Category/Purity already exists: "${dup.name}". Select it instead of creating a duplicate.`);
  } else {
    const dup = await checkDuplicateName(s, "items", header.name, {
      excludeId: id,
      scope: { item_class_id: p.data.item_class_id },
    });
    if (!dup.ok) return fail(dup.error);
  }
  const dupCode = await checkDuplicateName(s, "items", header.code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
    scope: { item_class_id: p.data.item_class_id },
  });
  if (!dupCode.ok) return fail(dupCode.error);
  if (classCode === "FABRIC" && !p.data.fabric_type_id) {
    return fail("Fabric Type is required (Solid, Yarn-dyed or Melange) — it determines the dyeing PO type.");
  }
  const { error } = await s.from("items").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace all child grids wholesale.
  const d1 = await s.from("material_mixings").delete().eq("item_id", id);
  if (d1.error) return fail(d1.error.message);
  const d2 = await s.from("material_uom_conversions").delete().eq("item_id", id);
  if (d2.error) return fail(d2.error.message);
  const d3 = await s.from("material_using_items").delete().eq("item_id", id);
  if (d3.error) return fail(d3.error.message);
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
  const ui = normUsingItems(p.data);
  if (ui.length) {
    const { error: e } = await s.from("material_using_items").insert(ui.map((r) => ({ ...r, item_id: id })));
    if (e) return fail(e.message);
  }
  rev();
  return { ok: true };
}

export async function deleteMaterial(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "items", id, "is_active"); // grids cascade; FK-in-use → inactive instead
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}
