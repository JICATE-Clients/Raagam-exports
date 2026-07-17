"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { categoryInput, type CategoryInput } from "./category-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/categories");
}

export async function createCategory(data: CategoryInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = categoryInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "categories", p.data.name, {
    scope: { item_class_id: p.data.item_class_id },
  });
  if (!dup.ok) return fail(dup.error);
  const { data: created, error } = await s.from("categories").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: created.id };
}

export async function updateCategory(id: string, data: CategoryInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = categoryInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "categories", p.data.name, {
    excludeId: id,
    scope: { item_class_id: p.data.item_class_id },
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("categories").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "categories", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

/** Inline "+ New" Item Class add from the Category picker — returns the new id
 *  so the caller can immediately select it. Item Class = config_lookups kind. */
export async function createItemClass(
  input: { code: string | null; name: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await can("masters", "create"))) return { ok: false, error: "Forbidden" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required" };
  const s = await createClient();
  const dup = await checkDuplicateName(s, "config_lookups", name, { scope: { kind: "item_class" } });
  if (!dup.ok) return { ok: false, error: dup.error };
  const code = input.code?.trim() || null;
  const dupCode = await checkDuplicateName(s, "config_lookups", code, {
    nameColumn: "code",
    label: "code",
    scope: { kind: "item_class" },
  });
  if (!dupCode.ok) return { ok: false, error: dupCode.error };
  const { data, error } = await s
    .from("config_lookups")
    .insert({ kind: "item_class", code, name, is_active: true })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true, id: data.id };
}
