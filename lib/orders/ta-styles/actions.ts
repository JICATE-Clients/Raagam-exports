"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { taStyleInput, type TaStyleInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/ta-style");
  revalidatePath("/orders");
}

/** Drop blank rows (no Activity picked) and renumber sno. */
function normalizeActivities(data: TaStyleInput) {
  return data.activities
    .filter((a) => !!a.activity_id)
    .map((a, i) => ({
      sno: i + 1,
      activity_id: a.activity_id as string,
      from_activity_id: a.from_activity_id ?? null,
      days_required: a.days_required ?? 0,
    }));
}

/**
 * Provisional T&A roll-up (real formula unconfirmed — logged in open questions):
 * No of Days = Σ days_required; Target Days = lead + start + No of Days.
 */
function computeDays(data: TaStyleInput, rows: ReturnType<typeof normalizeActivities>) {
  const no_of_days = rows.reduce((sum, r) => sum + (r.days_required || 0), 0);
  const target_days = (data.lead_days || 0) + (data.start_days || 0) + no_of_days;
  return { no_of_days, target_days };
}

function headerOnly(data: TaStyleInput, computed: { no_of_days: number; target_days: number }) {
  const { activities: _a, ...header } = data;
  void _a;
  return { ...header, ...computed };
}

async function writeActivities(
  s: Awaited<ReturnType<typeof createClient>>,
  styleId: string,
  rows: ReturnType<typeof normalizeActivities>,
): Promise<Result> {
  const { error: delErr } = await s
    .from("ta_style_activities")
    .delete()
    .eq("style_id", styleId);
  if (delErr) return fail(delErr.message);

  if (rows.length) {
    const { error } = await s
      .from("ta_style_activities")
      .insert(rows.map((r) => ({ ...r, style_id: styleId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

export async function createTaStyle(data: TaStyleInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = taStyleInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const rows = normalizeActivities(p.data);
  const computed = computeDays(p.data, rows);
  const s = await createClient();

  const { data: created, error } = await s
    .from("ta_styles")
    .insert(headerOnly(p.data, computed))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create TA style");

  const childRes = await writeActivities(s, created.id, rows);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "ta_style.created",
    entityType: "ta_style",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateTaStyle(id: string, data: TaStyleInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = taStyleInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const rows = normalizeActivities(p.data);
  const computed = computeDays(p.data, rows);
  const s = await createClient();

  const { error } = await s
    .from("ta_styles")
    .update(headerOnly(p.data, computed))
    .eq("id", id);
  if (error) return fail(error.message);

  const childRes = await writeActivities(s, id, rows);
  if (!childRes.ok) return childRes;

  rev();
  return { ok: true };
}

export async function deleteTaStyle(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("ta_styles").delete().eq("id", id); // activities cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
