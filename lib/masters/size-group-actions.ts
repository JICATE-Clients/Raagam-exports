"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { sizeGroupInput, type SizeGroupInput } from "./size-group-types";
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
  revalidatePath("/masters/materials/size-groups");
}

export async function createSizeGroup(
  data: SizeGroupInput,
  children: { size_name: string; sort_order: number | null }[],
): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = sizeGroupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "size_groups", p.data.size_group_no, {
    nameColumn: "size_group_no",
  });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s
    .from("size_groups")
    .insert(p.data)
    .select("id")
    .single();
  if (error) return fail(error.message);
  if (children.length > 0) {
    const { error: childErr } = await s.from("size_group_sizes").insert(
      children.map((c) => ({ size_group_id: row.id, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function updateSizeGroup(
  id: string,
  data: SizeGroupInput,
  children: { size_name: string; sort_order: number | null }[],
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = sizeGroupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "size_groups", p.data.size_group_no, {
    nameColumn: "size_group_no",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("size_groups").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  // Replace children wholesale
  await s.from("size_group_sizes").delete().eq("size_group_id", id);
  if (children.length > 0) {
    const { error: childErr } = await s.from("size_group_sizes").insert(
      children.map((c) => ({ size_group_id: id, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true };
}

export async function deactivateSizeGroup(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("size_groups").update({ blocked: true }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
