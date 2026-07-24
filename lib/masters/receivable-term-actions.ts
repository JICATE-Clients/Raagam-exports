"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { receivableTermInput, type ReceivableTermInput } from "./receivable-term-types";
import { deleteOrDeactivate } from "./delete-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/receivable-term");
}

export async function createReceivableTerm(data: ReceivableTermInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = receivableTermInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("receivable_terms").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateReceivableTerm(id: string, data: ReceivableTermInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = receivableTermInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("receivable_terms").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteReceivableTerm(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "receivable_terms", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
