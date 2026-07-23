"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { productionSectionInput, type ProductionSectionInput } from "./production-section-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";
import { generateUniqueCode } from "./auto-code";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/production");
  revalidatePath("/masters/production/production-sections");
}

export async function createProductionSection(data: ProductionSectionInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = productionSectionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  if (!p.data.code.trim()) {
    p.data.code = await generateUniqueCode(s, "production_sections", p.data.name);
  } else {
    const dup = await checkDuplicateName(s, "production_sections", p.data.code, {
      nameColumn: "code",
      label: "code",
    });
    if (!dup.ok) return fail(dup.error);
  }
  const { data: row, error } = await s.from("production_sections").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateProductionSection(id: string, data: ProductionSectionInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = productionSectionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Blank code on update = keep the stored one (the form doesn't edit codes).
  const row: Partial<ProductionSectionInput> = { ...p.data };
  if (!p.data.code.trim()) delete row.code;
  else {
    const dup = await checkDuplicateName(s, "production_sections", p.data.code, {
      nameColumn: "code",
      label: "code",
      excludeId: id,
    });
    if (!dup.ok) return fail(dup.error);
  }
  const { error } = await s.from("production_sections").update(row).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteProductionSection(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "production_sections", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
