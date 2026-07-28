"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { categoryInput, type CategoryInput } from "./category-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/categories");
}

/** Header columns only — `sub_categories` is a child table, not a column, and
 *  `insert(p.data)` would reject the array. */
function toHeader(d: CategoryInput) {
  const { sub_categories: _sc, ...header } = d;
  void _sc;
  return header;
}

/** Sub-category rows worth persisting, renumbered 1..n in display order. */
function normalizeSubCategories(d: CategoryInput) {
  // Flag off ⇒ the category has no second level, whatever the client sent.
  if (!d.has_sub_categories) return [];
  return d.sub_categories
    .map((c) => ({ ...c, name: c.name.trim().toUpperCase() }))
    .filter((c) => c.name.length > 0)
    .map((c, i) => ({ id: c.id, sno: i + 1, name: c.name }));
}

/**
 * Reconcile the child rows BY ID instead of the delete-all-then-reinsert every
 * other child grid in this codebase uses.
 *
 * That shortcut is safe only when nothing references the children. Here
 * `items.sub_category_id` does, so regenerating ids on every category save
 * would break the link on every material in the category — the same failure
 * that already bites material_attribute_lines (editing a set nulls every
 * material's saved answers). Existing rows keep their id; only genuinely
 * removed ones are deleted.
 */
async function syncSubCategories(
  s: Awaited<ReturnType<typeof createClient>>,
  categoryId: string,
  data: CategoryInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = normalizeSubCategories(data);
  const keepIds = rows.map((r) => r.id).filter((id): id is string => !!id);

  // Drop the rows the user removed. ON DELETE RESTRICT means this fails loudly
  // if a material still points at one — which is the desired answer, not a bug.
  let del = s.from("category_sub_categories").delete().eq("category_id", categoryId);
  if (keepIds.length) del = del.not("id", "in", `(${keepIds.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) {
    if (delErr.code === "23503") {
      return {
        ok: false,
        error:
          "That sub-category is still assigned to one or more materials. Reassign those materials first, or rename it instead of removing it.",
      };
    }
    return { ok: false, error: delErr.message };
  }

  for (const r of rows.filter((r) => r.id)) {
    const { error } = await s
      .from("category_sub_categories")
      .update({ sno: r.sno, name: r.name })
      .eq("id", r.id as string);
    if (error) return { ok: false, error: subCategoryError(error) };
  }

  const fresh = rows.filter((r) => !r.id).map((r) => ({ category_id: categoryId, sno: r.sno, name: r.name }));
  if (fresh.length) {
    const { error } = await s.from("category_sub_categories").insert(fresh);
    if (error) return { ok: false, error: subCategoryError(error) };
  }
  return { ok: true };
}

/** uq_category_sub_categories_name (0349) is case-insensitive per category. */
function subCategoryError(e: { code?: string; message: string }): string {
  if (e.code === "23505") {
    return "This category already has a sub-category with that name.";
  }
  return e.message;
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
  const { data: created, error } = await s.from("categories").insert(toHeader(p.data)).select("id").single();
  if (error) return fail(error.message);
  const sub = await syncSubCategories(s, created.id, p.data);
  if (!sub.ok) return fail(sub.error);
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
  const { error } = await s.from("categories").update(toHeader(p.data)).eq("id", id);
  if (error) return fail(error.message);
  const sub = await syncSubCategories(s, id, p.data);
  if (!sub.ok) return fail(sub.error);
  rev();
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "categories", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
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
