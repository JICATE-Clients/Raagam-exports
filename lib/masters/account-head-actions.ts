"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { accountHeadInput, type AccountHeadInput } from "./account-head-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/account-head");
}

export async function createAccountHead(data: AccountHeadInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = accountHeadInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("account_heads").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateAccountHead(id: string, data: AccountHeadInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = accountHeadInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("account_heads").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteAccountHead(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("account_heads").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
