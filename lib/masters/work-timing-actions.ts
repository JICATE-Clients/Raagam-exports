"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { workTimingInput, type WorkTimingInput } from "./work-timing-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/work-timing");
}

/** Drop empty shift rows (no category + no count) and renumber sno. */
function normalizeLines(data: WorkTimingInput) {
  return data.lines
    .filter((l) => l.shift_category_id || l.no_of_shifts != null || l.applicable_for_all_categories)
    .map((l, i) => ({
      sno: i + 1,
      shift_category_id: l.shift_category_id ?? null,
      no_of_shifts: l.no_of_shifts ?? null,
      applicable_for_all_categories: l.applicable_for_all_categories,
    }));
}

async function writeLines(
  s: Awaited<ReturnType<typeof createClient>>,
  workTimingId: string,
  data: WorkTimingInput,
): Promise<Result> {
  const { error: delErr } = await s
    .from("work_timing_lines")
    .delete()
    .eq("work_timing_id", workTimingId);
  if (delErr) return fail(delErr.message);
  const rows = normalizeLines(data);
  if (rows.length) {
    const { error } = await s
      .from("work_timing_lines")
      .insert(rows.map((r) => ({ ...r, work_timing_id: workTimingId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

export async function createWorkTiming(data: WorkTimingInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = workTimingInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s
    .from("work_timings")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const lineRes = await writeLines(s, created.id, p.data);
  if (!lineRes.ok) return lineRes;
  rev();
  return { ok: true };
}

export async function updateWorkTiming(id: string, data: WorkTimingInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = workTimingInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("work_timings").update(header).eq("id", id);
  if (error) return fail(error.message);
  const lineRes = await writeLines(s, id, p.data);
  if (!lineRes.ok) return lineRes;
  rev();
  return { ok: true };
}

export async function deleteWorkTiming(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("work_timings").delete().eq("id", id); // lines cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
