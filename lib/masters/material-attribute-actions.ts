"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  materialAttributeInput,
  type MaterialAttributeInput,
} from "./material-attribute-types";

type Result = { ok: true } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/material-attributes");
}
function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/** Drop blank lines (no attribute selected) and renumber sno 1..n. */
function normalizeLines(data: MaterialAttributeInput) {
  return data.lines
    .filter((l) => l.attribute_id)
    .map((l, i) => ({
      sno: i + 1,
      attribute_id: l.attribute_id,
      value_in_steps: l.value_in_steps,
      start_value: l.start_value,
      end_value: l.end_value,
      unit_id: l.unit_id,
      step_value: l.step_value,
      mandatory: l.mandatory,
      blocked: l.blocked,
    }));
}

export async function createMaterialAttribute(data: MaterialAttributeInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = materialAttributeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s
    .from("material_attributes")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeLines(p.data);
  if (rows.length) {
    const { error: lErr } = await s
      .from("material_attribute_lines")
      .insert(rows.map((r) => ({ ...r, material_attribute_id: created.id })));
    if (lErr) return fail(lErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateMaterialAttribute(
  id: string,
  data: MaterialAttributeInput,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = materialAttributeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("material_attributes").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the line grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s
    .from("material_attribute_lines")
    .delete()
    .eq("material_attribute_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeLines(p.data);
  if (rows.length) {
    const { error: lErr } = await s
      .from("material_attribute_lines")
      .insert(rows.map((r) => ({ ...r, material_attribute_id: id })));
    if (lErr) return fail(lErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteMaterialAttribute(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("material_attributes").delete().eq("id", id); // lines cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
