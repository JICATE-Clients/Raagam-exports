"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { holidayInput, type HolidayInput } from "./holiday-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/holiday");
}

/** Drop end_date unless a date range is actually in effect. */
function clean(data: HolidayInput): HolidayInput {
  const end = data.is_date_range && data.end_date && data.end_date.trim() ? data.end_date : null;
  return { ...data, end_date: end };
}

export async function createHoliday(data: HolidayInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = holidayInput.safeParse(clean(data));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("holidays").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateHoliday(id: string, data: HolidayInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = holidayInput.safeParse(clean(data));
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("holidays").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteHoliday(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("holidays").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
