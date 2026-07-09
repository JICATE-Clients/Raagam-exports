"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { allowanceInput, type AllowanceInput } from "./allowance-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/allowance");
}

/**
 * The Fixed/Variable band only exists for "Other Allowance" in legacy — drop
 * its two fields when the plain "Allowance" type is chosen so stale values from
 * a prior edit can't linger on the row.
 */
function normalize(data: AllowanceInput): AllowanceInput {
  if (data.allowance_type === "Allowance") {
    return { ...data, calc_type: null, calc_basis: null };
  }
  return data;
}

export async function createAllowance(data: AllowanceInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = allowanceInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("allowances").insert(normalize(p.data));
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateAllowance(id: string, data: AllowanceInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = allowanceInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("allowances").update(normalize(p.data)).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteAllowance(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("allowances").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
