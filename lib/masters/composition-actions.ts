"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { compositionInput, type CompositionInput } from "./composition-types";
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
  revalidatePath("/masters/materials/compositions");
}

/** Drop blank-description mixing rows and renumber sno 1..n. */
function normalizeLines(data: CompositionInput): { sno: number; description: string; mixing_pct: number }[] {
  return data.lines
    .map((l) => ({ ...l, description: l.description.trim() }))
    .filter((l) => l.description.length > 0)
    .map((l, i) => ({ sno: i + 1, description: l.description, mixing_pct: l.mixing_pct }));
}

export async function createComposition(data: CompositionInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = compositionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const dup = await checkDuplicateName(s, "compositions", header.name);
  if (!dup.ok) return fail(dup.error);
  const { data: created, error } = await s
    .from("compositions")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeLines(p.data);
  if (rows.length) {
    const { error: lErr } = await s
      .from("composition_lines")
      .insert(rows.map((r) => ({ ...r, composition_id: created.id })));
    if (lErr) return fail(lErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateComposition(id: string, data: CompositionInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = compositionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const dup = await checkDuplicateName(s, "compositions", header.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("compositions").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the mixing grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("composition_lines").delete().eq("composition_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeLines(p.data);
  if (rows.length) {
    const { error: lErr } = await s
      .from("composition_lines")
      .insert(rows.map((r) => ({ ...r, composition_id: id })));
    if (lErr) return fail(lErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteComposition(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "compositions", id, "blocked"); // lines cascade
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
