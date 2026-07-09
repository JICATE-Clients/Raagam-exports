"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { advanceLoanTypeInput, type AdvanceLoanTypeInput } from "./advance-loan-type-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/advance-loan-type");
}

export async function createAdvanceLoanType(data: AdvanceLoanTypeInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = advanceLoanTypeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("advance_loan_types").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateAdvanceLoanType(id: string, data: AdvanceLoanTypeInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = advanceLoanTypeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("advance_loan_types").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteAdvanceLoanType(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("advance_loan_types").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
