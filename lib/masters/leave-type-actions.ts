"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { leaveTypeInput, type LeaveTypeInput } from "./leave-type-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/leave-type");
}

export async function createLeaveType(data: LeaveTypeInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = leaveTypeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("leave_types").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateLeaveType(id: string, data: LeaveTypeInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = leaveTypeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("leave_types").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteLeaveType(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("leave_types").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
