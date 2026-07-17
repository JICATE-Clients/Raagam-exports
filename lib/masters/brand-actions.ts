"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { brandInput, type BrandInput } from "./brand-types";
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
  revalidatePath("/masters/materials/brands");
}

export async function createBrand(data: BrandInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = brandInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "brands", p.data.brand_name, { nameColumn: "brand_name" });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s.from("brands").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateBrand(id: string, data: BrandInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = brandInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "brands", p.data.brand_name, { nameColumn: "brand_name", excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("brands").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteBrand(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("brands").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
