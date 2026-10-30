"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { groupTimingInput, type GroupTimingInput } from "./group-timing-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/work-timing");
  revalidatePath("/hr");
}

/**
 * Save one group's hours. The key is (group, Effective From): the same date
 * again CORRECTS that revision, a later date ADDS one — so changing the hours
 * from 1 November never rewrites how 31 October is judged.
 */
// dup-check: exempt -- keyed by (group, effective_from); a second row on a
// later date is how a change of hours is entered, and the same date updates.
export async function saveGroupTiming(data: GroupTimingInput): Promise<Result> {
  const p = groupTimingInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();

  const { data: existing, error: findErr } = await s
    .from("hr_group_timings")
    .select("id")
    .eq("timing_group", p.data.timing_group)
    .eq("effective_from", p.data.effective_from)
    .maybeSingle();
  if (findErr) return fail(findErr.message);

  if (existing) {
    if (!(await can("masters", "edit"))) return fail("Forbidden");
    const { error } = await s.from("hr_group_timings").update(p.data).eq("id", existing.id);
    if (error) return fail(error.message);
  } else {
    if (!(await can("masters", "create"))) return fail("Forbidden");
    const { error } = await s.from("hr_group_timings").insert(p.data);
    if (error) return fail(error.message);
  }
  rev();
  return { ok: true };
}

/** Remove one dated revision (an entry made by mistake). */
export async function deleteGroupTiming(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("hr_group_timings").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
