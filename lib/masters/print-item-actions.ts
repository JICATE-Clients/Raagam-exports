"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { printItemInput, type PrintItemInput } from "./print-item-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/production");
  revalidatePath("/masters/production/print-items");
}

export async function createPrintItem(data: PrintItemInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = printItemInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "print_items", p.data.code, { nameColumn: "code", label: "code" });
  if (!dupCode.ok) return fail(dupCode.error);
  const dupName = await checkDuplicateName(s, "print_items", p.data.name, { label: "name" });
  if (!dupName.ok) return fail(dupName.error);
  const { data: row, error } = await s.from("print_items").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updatePrintItem(id: string, data: PrintItemInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = printItemInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "print_items", p.data.code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const dupName = await checkDuplicateName(s, "print_items", p.data.name, { label: "name", excludeId: id });
  if (!dupName.ok) return fail(dupName.error);
  const { error } = await s.from("print_items").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deletePrintItem(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "print_items", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}
