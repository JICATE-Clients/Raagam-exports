"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { categoryInput, type CategoryInput } from "./category-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/categories");
}

export async function createCategory(data: CategoryInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = categoryInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("categories").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateCategory(id: string, data: CategoryInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = categoryInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("categories").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("categories").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
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
  const { data, error } = await s
    .from("config_lookups")
    .insert({ kind: "item_class", code: input.code?.trim() || null, name, is_active: true })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true, id: data.id };
}
