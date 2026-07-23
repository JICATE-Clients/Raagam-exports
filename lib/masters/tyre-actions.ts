"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { tyreInput, type TyreInput } from "./tyre-types";
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
  revalidatePath("/masters/logistics");
  revalidatePath("/masters/logistics/tyres");
}

export async function createTyre(data: TyreInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = tyreInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupName = await checkDuplicateName(s, "tyres", p.data.name, { label: "name" });
  if (!dupName.ok) return fail(dupName.error);
  if (!p.data.code.trim()) {
    p.data.code = await generateUniqueCode(s, "tyres", p.data.name);
  } else {
    const dupCode = await checkDuplicateName(s, "tyres", p.data.code, { nameColumn: "code", label: "code" });
    if (!dupCode.ok) return fail(dupCode.error);
  }
  const { data: row, error } = await s.from("tyres").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateTyre(id: string, data: TyreInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = tyreInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupName = await checkDuplicateName(s, "tyres", p.data.name, { label: "name", excludeId: id });
  if (!dupName.ok) return fail(dupName.error);
  // Blank code on update = keep the stored one (the form doesn't edit codes).
  const row: Partial<TyreInput> = { ...p.data };
  if (!p.data.code.trim()) delete row.code;
  else {
    const dupCode = await checkDuplicateName(s, "tyres", p.data.code, {
      nameColumn: "code",
      label: "code",
      excludeId: id,
    });
    if (!dupCode.ok) return fail(dupCode.error);
  }
  const { error } = await s.from("tyres").update(row).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteTyre(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "tyres", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
