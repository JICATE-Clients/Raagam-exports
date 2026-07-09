"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { accountGroupInput, type AccountGroupInput } from "./account-group-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/account-group");
}

export async function createAccountGroup(data: AccountGroupInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = accountGroupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("account_groups").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateAccountGroup(id: string, data: AccountGroupInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = accountGroupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  if (p.data.parent_id === id) return fail("A group cannot be under itself.");
  const s = await createClient();
  const { error } = await s.from("account_groups").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteAccountGroup(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("account_groups").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
