"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { levyInput, type LevyInput } from "./levy-types";
import { deleteOrDeactivate } from "./delete-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/levies");
}
function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

export async function createLevy(data: LevyInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = levyInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("levies").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateLevy(id: string, data: LevyInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = levyInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("levies").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteLevy(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "levies", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}
