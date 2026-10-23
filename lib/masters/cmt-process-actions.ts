"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { cmtProcessInput, type CmtProcessInput } from "./cmt-process-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/cmt-processes");
  revalidatePath("/sales/sample-costing");
}

export async function createCmtProcess(data: CmtProcessInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = cmtProcessInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "cmt_processes", p.data.name);
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("cmt_processes").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateCmtProcess(id: string, data: CmtProcessInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = cmtProcessInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "cmt_processes", p.data.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("cmt_processes").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteCmtProcess(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // A costing line holding the operation keeps it: the guard deactivates instead.
  const res = await deleteOrDeactivate(s, "cmt_processes", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
