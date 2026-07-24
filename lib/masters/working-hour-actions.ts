"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { workingHourInput, type WorkingHourInput } from "./working-hour-types";
import { deleteOrBlock } from "./delete-guard";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/working-hour");
}

export async function createWorkingHour(data: WorkingHourInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = workingHourInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("working_hours").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateWorkingHour(id: string, data: WorkingHourInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = workingHourInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("working_hours").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteWorkingHour(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // No inactive flag — block (with a "used by X" message) when referenced.
  const res = await deleteOrBlock(s, "working_hours", id);
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true };
}
