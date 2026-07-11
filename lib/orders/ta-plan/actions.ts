"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { taPlanDocInput, type TaPlanDocInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/ta-plan");
}

/** Empty/whitespace string → null (date & text columns reject ""). */
function blank(v: string | null | undefined): string | null {
  return v && v.trim() ? v : null;
}

/** Drop blank grid rows (no activity picked) and renumber sno. */
function normalizeActivities(data: TaPlanDocInput) {
  let n = 0;
  return data.activities
    .filter((a) => !!a.activity_id)
    .map((a) => ({
      sno: ++n,
      activity_id: a.activity_id,
      from_activity_id: a.from_activity_id,
      details: blank(a.details),
      start_date: blank(a.start_date),
      days_required: a.days_required,
      end_date: blank(a.end_date),
    }));
}

function headerOnly(data: TaPlanDocInput) {
  const { activities: _a, ...h } = data;
  void _a;
  return {
    ...h,
    order_no: blank(h.order_no),
    start_date: blank(h.start_date),
    delivery_date: blank(h.delivery_date),
    proposed_delivery_date: blank(h.proposed_delivery_date),
    target_date: blank(h.target_date),
  };
}

async function writeActivities(
  s: Awaited<ReturnType<typeof createClient>>,
  planId: string,
  data: TaPlanDocInput,
): Promise<Result> {
  const { error: delErr } = await s
    .from("ta_plan_activities")
    .delete()
    .eq("plan_id", planId);
  if (delErr) return fail(delErr.message);

  const rows = normalizeActivities(data);
  if (rows.length) {
    const { error } = await s
      .from("ta_plan_activities")
      .insert(rows.map((r) => ({ ...r, plan_id: planId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

export async function createTaPlan(data: TaPlanDocInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = taPlanDocInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("ta_plan_docs")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create plan");
  const childRes = await writeActivities(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "ta_plan.created",
    entityType: "ta_plan_doc",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateTaPlan(id: string, data: TaPlanDocInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = taPlanDocInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("ta_plan_docs").update(headerOnly(p.data)).eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeActivities(s, id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function deleteTaPlan(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("ta_plan_docs").delete().eq("id", id); // activities cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
