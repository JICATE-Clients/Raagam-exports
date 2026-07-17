"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { packingMethodInput, type PackingMethodInput } from "./packing-method-types";
import { checkDuplicateName } from "./dup-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/packing-methods");
}

export async function createPackingMethod(
  data: PackingMethodInput,
  children: { sort_order: number | null; category_name: string }[],
): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = packingMethodInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "packing_methods", p.data.packing_type, {
    nameColumn: "packing_type",
  });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s
    .from("packing_methods")
    .insert(p.data)
    .select("id")
    .single();
  if (error) return fail(error.message);
  if (children.length > 0) {
    const { error: childErr } = await s.from("packing_method_categories").insert(
      children.map((c) => ({ packing_method_id: row.id, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function updatePackingMethod(
  id: string,
  data: PackingMethodInput,
  children: { sort_order: number | null; category_name: string }[],
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = packingMethodInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "packing_methods", p.data.packing_type, {
    nameColumn: "packing_type",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("packing_methods").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  // Replace children wholesale
  await s.from("packing_method_categories").delete().eq("packing_method_id", id);
  if (children.length > 0) {
    const { error: childErr } = await s.from("packing_method_categories").insert(
      children.map((c) => ({ packing_method_id: id, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true };
}

export async function deactivatePackingMethod(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("packing_methods").update({ inactive: true }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
