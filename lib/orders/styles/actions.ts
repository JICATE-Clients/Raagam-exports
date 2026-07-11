"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { garmentStyleInput, type GarmentStyleInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/styles");
  revalidatePath("/orders");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------- child normalizers (drop fully-empty rows + renumber sno) ----------

function normalizeCoordinates(data: GarmentStyleInput) {
  return data.coordinates
    .map((c) => ({ coordinate_id: c.coordinate_id ?? null, mlist_no: clean(c.mlist_no) }))
    .filter((c) => c.coordinate_id || c.mlist_no)
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

function normalizeComponents(data: GarmentStyleInput) {
  return data.components
    .map((c) => ({
      coordinate_id: c.coordinate_id ?? null,
      component_id: c.component_id ?? null,
      structure_id: c.structure_id ?? null,
      comp_type: clean(c.comp_type),
      trims: !!c.trims,
      trims_category_id: c.trims_category_id ?? null,
    }))
    .filter(
      (c) =>
        c.coordinate_id ||
        c.component_id ||
        c.structure_id ||
        c.comp_type ||
        c.trims ||
        c.trims_category_id,
    )
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

function normalizeSizes(data: GarmentStyleInput) {
  return data.sizes
    .filter((s) => !!s.size_id)
    .map((s, i) => ({ size_id: s.size_id as string, sno: i + 1 }));
}

/** Replace every child grid wholesale for a given style id. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  styleId: string,
  data: GarmentStyleInput,
): Promise<Result> {
  const tables = [
    "garment_style_coordinates",
    "garment_style_components",
    "garment_style_sizes",
  ];
  for (const t of tables) {
    const { error } = await s.from(t).delete().eq("style_id", styleId);
    if (error) return fail(error.message);
  }

  const inserts: [string, Record<string, unknown>[]][] = [
    ["garment_style_coordinates", normalizeCoordinates(data)],
    ["garment_style_components", normalizeComponents(data)],
    ["garment_style_sizes", normalizeSizes(data)],
  ];
  for (const [table, rows] of inserts) {
    if (!rows.length) continue;
    const { error } = await s
      .from(table)
      .insert(rows.map((r) => ({ ...r, style_id: styleId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

/** Strip child arrays so only header columns hit garment_styles. */
function headerOnly(data: GarmentStyleInput) {
  const { coordinates: _c, components: _m, sizes: _s, ...header } = data;
  void _c;
  void _m;
  void _s;
  return header;
}

export async function createGarmentStyle(data: GarmentStyleInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = garmentStyleInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("garment_styles")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create style");
  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_style.created",
    entityType: "garment_style",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateGarmentStyle(
  id: string,
  data: GarmentStyleInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = garmentStyleInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("garment_styles").update(headerOnly(p.data)).eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_style.updated",
    entityType: "garment_style",
    entityId: id,
  });
  rev();
  return { ok: true };
}

export async function deleteGarmentStyle(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("garment_styles").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
