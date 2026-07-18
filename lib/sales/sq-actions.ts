"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { sqDetailInput, sqGroupInput, sqDetailNoteInput, sqCancellationInput } from "./sq-types";
import type { SqDetailInput, SqGroupInput, SqDetailNoteInput, SqCancellationInput } from "./sq-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/sales");
  revalidatePath("/sales/sq-details");
}

// ---------------------------------------------------------------------------
// SQ Detail
// ---------------------------------------------------------------------------

export async function createSqDetail(data: SqDetailInput): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = sqDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("sq_details").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateSqDetail(id: string, data: SqDetailInput): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const p = sqDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("sq_details").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function confirmSqDetail(id: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("sq_details").update({ status: "confirmed" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteSqDetail(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("sq_details").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SQ Groups
// ---------------------------------------------------------------------------

export async function createSqGroup(data: SqGroupInput): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = sqGroupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("sq_groups").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteSqGroup(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("sq_groups").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SQ Packs (child of SQ Detail)
// ---------------------------------------------------------------------------

export async function addSqPack(
  sqDetailId: string,
  data: { country_code?: string | null; consignee_name?: string | null; assortment_type?: string | null; no_of_cartons?: number | null; sq_qty?: number; delivery_date?: string | null },
): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("sq_packs").select("sno").eq("sq_detail_id", sqDetailId).order("sno", { ascending: false }).limit(1);
  const nextSno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("sq_packs").insert({ sq_detail_id: sqDetailId, sno: nextSno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteSqPack(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("sq_packs").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SQ Notes
// ---------------------------------------------------------------------------

export async function createSqDetailNote(data: SqDetailNoteInput): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = sqDetailNoteInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("sq_detail_notes").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteSqDetailNote(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("sq_detail_notes").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SQ Cancellations
// ---------------------------------------------------------------------------

export async function cancelSq(data: SqCancellationInput): Promise<CreateResult> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const p = sqCancellationInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Create cancellation record
  const { data: row, error } = await s.from("sq_cancellations").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  // Mark SQ as cancelled
  await s.from("sq_details").update({ is_cancelled: true, status: "cancelled" }).eq("id", p.data.sq_detail_id);
  rev();
  return { ok: true, id: row.id };
}
