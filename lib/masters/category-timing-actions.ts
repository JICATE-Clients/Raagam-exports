"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { BREAKS, categoryTimingInput, type CategoryTimingInput } from "./category-timing-types";

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
 * Save one category's hours. The key is (category, Effective From): the same
 * date again CORRECTS that revision, a later date ADDS one — so changing the
 * hours from 1 November never rewrites how 31 October is judged.
 */
// dup-check: exempt -- keyed by (category, effective_from); a second row on a
// later date is how a change of hours is entered, and the same date updates.
export async function saveCategoryTiming(data: CategoryTimingInput): Promise<Result> {
  const p = categoryTimingInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // With no break entered the break columns are left out, so a save still
  // works on a database where 0775 has not been applied yet.
  const row: Partial<typeof p.data> = { ...p.data };
  if (BREAKS.every((b) => !p.data[b.start] && !p.data[b.end])) {
    for (const b of BREAKS) {
      delete row[b.start];
      delete row[b.end];
    }
  }

  const { data: existing, error: findErr } = await s
    .from("hr_category_timings")
    .select("id")
    .eq("category_id", p.data.category_id)
    .eq("effective_from", p.data.effective_from)
    .maybeSingle();
  if (findErr) return fail(findErr.message);

  if (existing) {
    if (!(await can("masters", "edit"))) return fail("Forbidden");
    const { error } = await s.from("hr_category_timings").update(row).eq("id", existing.id);
    if (error) return fail(error.message);
  } else {
    if (!(await can("masters", "create"))) return fail("Forbidden");
    const { error } = await s.from("hr_category_timings").insert(row as typeof p.data);
    if (error) return fail(error.message);
  }
  rev();
  return { ok: true };
}

/** Remove one dated revision (an entry made by mistake). */
export async function deleteCategoryTiming(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("hr_category_timings").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
