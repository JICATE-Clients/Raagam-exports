"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { pipelineOrderInput, seasonalOrderInput } from "./pipeline-types";
import type { PipelineOrderInput, SeasonalOrderInput } from "./pipeline-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/sales");
  revalidatePath("/sales/pipeline-orders");
}

export async function createPipelineOrder(data: PipelineOrderInput): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = pipelineOrderInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("pipeline_orders").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function confirmPipelineOrder(id: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("pipeline_orders").update({ status: "confirmed" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deletePipelineOrder(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("pipeline_orders").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function createSeasonalOrder(data: SeasonalOrderInput): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = seasonalOrderInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("seasonal_orders").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// Pipeline Order Styles (child)
// ---------------------------------------------------------------------------

export async function addPipelineStyle(
  pipelineOrderId: string,
  data: { style_ref_no?: string | null; style_no?: string | null; style_description?: string | null; uom_id?: string | null; order_qty?: number },
): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("pipeline_order_styles").select("sno").eq("pipeline_order_id", pipelineOrderId).order("sno", { ascending: false }).limit(1);
  const nextSno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("pipeline_order_styles").insert({ pipeline_order_id: pipelineOrderId, sno: nextSno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deletePipelineStyle(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("pipeline_order_styles").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pipeline Dyeing Colors (child)
// ---------------------------------------------------------------------------

export async function addPipelineDyeColor(
  pipelineOrderId: string,
  data: { color_type: string; description?: string | null; process_loss_pct?: number; dye_type?: string | null },
): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("pipeline_dyeing_colors").select("sno").eq("pipeline_order_id", pipelineOrderId).order("sno", { ascending: false }).limit(1);
  const nextSno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("pipeline_dyeing_colors").insert({ pipeline_order_id: pipelineOrderId, sno: nextSno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deletePipelineDyeColor(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("pipeline_dyeing_colors").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteSeasonalOrder(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("seasonal_orders").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
