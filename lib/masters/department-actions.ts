"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { departmentInput, type DepartmentInput } from "./department-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/department");
}

/** Drop rows with no location picked and renumber sno from 1. */
function normalizeLocations(data: DepartmentInput) {
  return data.locations
    .filter((l): l is { sno: number; location_id: string; all_divisions: boolean } => !!l.location_id)
    .map((l, i) => ({ sno: i + 1, location_id: l.location_id, all_divisions: l.all_divisions }));
}

async function writeLocations(
  s: Awaited<ReturnType<typeof createClient>>,
  departmentId: string,
  data: DepartmentInput,
): Promise<string | null> {
  const rows = normalizeLocations(data);
  if (!rows.length) return null;
  const { error } = await s
    .from("department_locations")
    .insert(rows.map((r) => ({ ...r, department_id: departmentId })));
  return error ? error.message : null;
}

export async function createDepartment(data: DepartmentInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = departmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { locations: _l, ...header } = p.data;
  void _l;
  const { data: created, error } = await s
    .from("departments")
    .insert({
      ...header,
      name: header.name || null,
      doc_prefix: header.doc_prefix || null,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const locErr = await writeLocations(s, created.id, p.data);
  if (locErr) return fail(locErr);
  rev();
  return { ok: true };
}

export async function updateDepartment(id: string, data: DepartmentInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = departmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { locations: _l, ...header } = p.data;
  void _l;
  const { error } = await s
    .from("departments")
    .update({
      ...header,
      name: header.name || null,
      doc_prefix: header.doc_prefix || null,
    })
    .eq("id", id);
  if (error) return fail(error.message);
  // Replace the Location grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("department_locations").delete().eq("department_id", id);
  if (delErr) return fail(delErr.message);
  const locErr = await writeLocations(s, id, p.data);
  if (locErr) return fail(locErr);
  rev();
  return { ok: true };
}

export async function deleteDepartment(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("departments").delete().eq("id", id); // locations cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
