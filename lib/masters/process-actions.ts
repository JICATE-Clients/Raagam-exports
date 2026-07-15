"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { processInput, type ProcessInput } from "./process-types";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/processes");
}

/** Clear sub-categories when Has Sub Categories is off; else drop blank-name
 *  rows and renumber sno 1..n so persisted lines mirror the checkbox. */
function normalizeSubCategories(
  data: ProcessInput,
): { sno: number; sub_category: string; short_description: string | null; hsn_code: string | null }[] {
  if (!data.has_sub_categories) return [];
  return data.sub_categories
    .map((c) => ({ ...c, sub_category: c.sub_category.trim() }))
    .filter((c) => c.sub_category.length > 0)
    .map((c, i) => ({
      sno: i + 1,
      sub_category: c.sub_category,
      short_description: c.short_description?.trim() || null,
      hsn_code: c.hsn_code?.trim() || null,
    }));
}

export async function createProcess(data: ProcessInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = processInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { sub_categories: _drop, ...header } = p.data;
  void _drop;
  const {
    data: { user },
  } = await s.auth.getUser();
  let createdBy: string | null = null;
  if (user) {
    const { data: profile } = await s
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();
    createdBy = profile?.full_name || profile?.email || null;
  }
  const dup = await checkDuplicateName(s, "processes", header.name);
  if (!dup.ok) return fail(dup.error);
  const { data: created, error } = await s
    .from("processes")
    .insert({ ...header, created_by: createdBy })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeSubCategories(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("process_sub_categories")
      .insert(rows.map((r) => ({ ...r, process_id: created.id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateProcess(id: string, data: ProcessInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = processInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { sub_categories: _drop, ...header } = p.data;
  void _drop;
  const dup = await checkDuplicateName(s, "processes", header.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("processes").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the sub-category grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("process_sub_categories").delete().eq("process_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeSubCategories(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("process_sub_categories")
      .insert(rows.map((r) => ({ ...r, process_id: id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteProcess(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("processes").delete().eq("id", id); // sub-cats cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
