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
    .filter((l) => !!l.location_id)
    .map((l, i) => ({ sno: i + 1, location_id: l.location_id!, all_divisions: l.all_divisions, divisions: l.divisions ?? [] }));
}

async function writeLocations(
  s: Awaited<ReturnType<typeof createClient>>,
  departmentId: string,
  data: DepartmentInput,
): Promise<string | null> {
  const rows = normalizeLocations(data);
  if (!rows.length) return null;
  // Insert location rows
  const { data: inserted, error } = await s
    .from("department_locations")
    .insert(rows.map((r) => ({ sno: r.sno, location_id: r.location_id, all_divisions: r.all_divisions, department_id: departmentId })))
    .select("id");
  if (error) return error.message;
  // Insert division rows for locations where all_divisions is false
  const divRows: { department_location_id: string; division_id: string; sno: number }[] = [];
  (inserted ?? []).forEach((loc, idx) => {
    const src = rows[idx];
    if (!src.all_divisions && src.divisions.length > 0) {
      src.divisions.forEach((d, di) => {
        divRows.push({ department_location_id: loc.id, division_id: d.division_id, sno: di + 1 });
      });
    }
  });
  if (divRows.length > 0) {
    const { error: divErr } = await s.from("department_location_divisions").insert(divRows);
    if (divErr) return divErr.message;
  }
  return null;
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
