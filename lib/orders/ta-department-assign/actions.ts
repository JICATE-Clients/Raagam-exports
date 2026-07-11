"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { taDeptAssignInput, type TaDeptAssignInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/ta-department-assign");
}

/** Drop blank grid rows (no activity picked) and renumber sno. */
function normalizeLines(data: TaDeptAssignInput) {
  let n = 0;
  return data.lines
    .filter((l) => !!l.activity_id)
    .map((l) => ({
      sno: ++n,
      activity_id: l.activity_id as string,
      is_owner: l.is_owner,
    }));
}

async function writeLines(
  s: Awaited<ReturnType<typeof createClient>>,
  assignId: string,
  data: TaDeptAssignInput,
): Promise<Result> {
  const { error: delErr } = await s
    .from("ta_department_assign_lines")
    .delete()
    .eq("assign_id", assignId);
  if (delErr) return fail(delErr.message);

  const rows = normalizeLines(data);
  if (rows.length) {
    const { error } = await s
      .from("ta_department_assign_lines")
      .insert(rows.map((r) => ({ ...r, assign_id: assignId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

function headerOnly(data: TaDeptAssignInput) {
  const { lines: _l, ...header } = data;
  void _l;
  return header;
}

export async function createTaDepartmentAssign(data: TaDeptAssignInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = taDeptAssignInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("ta_department_assigns")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create");
  const childRes = await writeLines(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "ta_department_assign.created",
    entityType: "ta_department_assign",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateTaDepartmentAssign(
  id: string,
  data: TaDeptAssignInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = taDeptAssignInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s
    .from("ta_department_assigns")
    .update(headerOnly(p.data))
    .eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeLines(s, id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function deleteTaDepartmentAssign(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("ta_department_assigns").delete().eq("id", id); // lines cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
