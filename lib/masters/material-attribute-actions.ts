"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  materialAttributeInput,
  type MaterialAttributeInput,
} from "./material-attribute-types";
import { deleteOrBlock } from "./delete-guard";

type Result = { ok: true } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/material-attributes");
}
function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** Drop blank lines (no attribute selected) and renumber sno 1..n. Options are
 *  kept alongside each line so they can be inserted once the line id exists. */
function normalizeLines(data: MaterialAttributeInput) {
  return data.lines
    .filter((l) => l.attribute_id)
    .map((l, i) => ({
      row: {
        sno: i + 1,
        attribute_id: l.attribute_id,
        value_in_steps: l.value_in_steps,
        start_value: l.start_value,
        end_value: l.end_value,
        unit_id: l.unit_id,
        step_value: l.step_value,
        mandatory: l.mandatory,
        inactive: l.inactive,
      },
      // Value-In-Steps lines are numeric ranges — never carry a value list.
      options: l.value_in_steps
        ? []
        : l.options
            .filter((o) => o.description.trim())
            .map((o, j) => ({ sno: j + 1, description: o.description.trim(), blocked: o.blocked })),
    }));
}

/** Insert the (already normalized) lines for one material_attribute, then insert
 *  each line's pre-defined value options against the freshly-created line ids. */
async function insertLines(
  s: SupabaseClient,
  materialAttributeId: string,
  lines: ReturnType<typeof normalizeLines>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!lines.length) return { ok: true };
  const { data: created, error } = await s
    .from("material_attribute_lines")
    .insert(lines.map((l) => ({ ...l.row, material_attribute_id: materialAttributeId })))
    .select("id, sno");
  if (error) return fail(error.message);
  // Map new line ids back by sno (insert preserves order, but match on sno to be safe).
  const idBySno = new Map((created ?? []).map((r) => [r.sno as number, r.id as string]));
  const optionRows = lines.flatMap((l) => {
    const lineId = idBySno.get(l.row.sno);
    return lineId ? l.options.map((o) => ({ ...o, material_attribute_line_id: lineId })) : [];
  });
  if (optionRows.length) {
    const { error: oErr } = await s.from("material_attribute_line_options").insert(optionRows);
    if (oErr) return fail(oErr.message);
  }
  return { ok: true };
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
  const ins = await insertLines(s, created.id, normalizeLines(p.data));
  if (!ins.ok) return ins;
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
  // Replace the line grid wholesale (line-option children cascade-delete).
  const { error: delErr } = await s
    .from("material_attribute_lines")
    .delete()
    .eq("material_attribute_id", id);
  if (delErr) return fail(delErr.message);
  const ins = await insertLines(s, id, normalizeLines(p.data));
  if (!ins.ok) return ins;
  rev();
  return { ok: true };
}

export async function deleteMaterialAttribute(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // Lines cascade (RPC ignores cascade children); block only if referenced elsewhere.
  const res = await deleteOrBlock(s, "material_attributes", id);
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true };
}
