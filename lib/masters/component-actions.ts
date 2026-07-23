"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { componentInput, type ComponentInput } from "./component-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/components");
}

/** Drop blank coordinate rows and renumber sno 1..n. */
function normalizeCoordinates(data: ComponentInput): { sno: number; coordinate: string }[] {
  return data.coordinates
    .map((c) => ({ ...c, coordinate: c.coordinate.trim() }))
    .filter((c) => c.coordinate.length > 0)
    .map((c, i) => ({ sno: i + 1, coordinate: c.coordinate }));
}

export async function createComponent(data: ComponentInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = componentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { coordinates: _drop, ...header } = p.data;
  void _drop;
  const dup = await checkDuplicateName(s, "components", header.short_name, { nameColumn: "short_name" });
  if (!dup.ok) return fail(dup.error);
  const { data: created, error } = await s
    .from("components")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeCoordinates(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("component_coordinates")
      .insert(rows.map((r) => ({ ...r, component_id: created.id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateComponent(id: string, data: ComponentInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = componentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { coordinates: _drop, ...header } = p.data;
  void _drop;
  const dup = await checkDuplicateName(s, "components", header.short_name, {
    nameColumn: "short_name",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("components").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the coordinates grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("component_coordinates").delete().eq("component_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeCoordinates(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("component_coordinates")
      .insert(rows.map((r) => ({ ...r, component_id: id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteComponent(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "components", id, "blocked"); // coordinates cascade
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
