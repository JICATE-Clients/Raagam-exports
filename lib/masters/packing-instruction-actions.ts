"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { packingInstructionInput, type PackingInstructionInput } from "./packing-instruction-types";
import { checkDuplicateName } from "./dup-guard";
import { generateUniqueCode } from "./auto-code";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/packing-instructions");
}

export async function createPackingInstruction(data: PackingInstructionInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = packingInstructionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "packing_instructions", p.data.packing_type, {
    nameColumn: "packing_type",
  });
  if (!dup.ok) return fail(dup.error);
  if (!p.data.packing_no?.trim()) {
    p.data.packing_no = await generateUniqueCode(s, "packing_instructions", p.data.packing_type, {
      codeColumn: "packing_no",
    });
  }
  const { data: row, error } = await s.from("packing_instructions").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updatePackingInstruction(id: string, data: PackingInstructionInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = packingInstructionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "packing_instructions", p.data.packing_type, {
    nameColumn: "packing_type",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  // Blank no. on update = keep the stored one (the form doesn't edit codes).
  const row: Partial<PackingInstructionInput> = { ...p.data };
  if (!p.data.packing_no?.trim()) delete row.packing_no;
  const { error } = await s.from("packing_instructions").update(row).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deletePackingInstruction(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "packing_instructions", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
