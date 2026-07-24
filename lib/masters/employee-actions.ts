"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { employeeInput, type EmployeeInput } from "./employee-types";
import { deleteOrDeactivate } from "./delete-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/employee");
}

/** Blank date/text → null so empty picker/date fields don't hit NOT-NULL/date casts. */
function clean(data: EmployeeInput): EmployeeInput {
  const blankToNull = (v: string | null | undefined) => v && v.trim() ? v : null;
  return {
    ...data,
    dob: blankToNull(data.dob),
    doj: blankToNull(data.doj),
    date_of_confirmation: blankToNull(data.date_of_confirmation),
    date_of_filing: blankToNull(data.date_of_filing),
  };
}

export async function createEmployee(data: EmployeeInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = employeeInput.safeParse(clean(data));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("employees").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateEmployee(id: string, data: EmployeeInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = employeeInput.safeParse(clean(data));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  // An employee cannot be their own manager.
  if (p.data.manager_id === id) return fail("An employee cannot be their own manager.");
  const s = await createClient();
  const { error } = await s.from("employees").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteEmployee(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "employees", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
