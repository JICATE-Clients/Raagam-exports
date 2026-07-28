"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { ganCheckInput, ganParameterInput } from "./gan-types";
import type { GanCheckInput, GanParameterInput } from "./gan-types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };

function revalidateGan(grnId: string): void {
  revalidatePath(`/purchase/grn/${grnId}`);
  revalidatePath(`/purchase/grn/${grnId}/quality`);
}

export async function createGanCheck(
  data: GanCheckInput,
): Promise<{ ok: true; checkId: string } | ErrResult> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const parsed = ganCheckInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: check, error } = await supabase
    .from("gan_quality_checks")
    .insert({
      ...parsed.data,
      status: "pending",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !check) return { ok: false, error: error?.message ?? "Failed" };

  revalidateGan(data.grn_id);
  return { ok: true, checkId: check.id };
}

export async function addGanParameter(
  grnId: string,
  data: GanParameterInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = ganParameterInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("gan_quality_parameters")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateGan(grnId);
  return { ok: true };
}

export async function completeGanCheck(
  checkId: string,
  grnId: string,
  overallResult: "pass" | "fail" | "conditional",
): Promise<OkResult | ErrResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("gan_quality_checks")
    .update({
      status: "completed",
      overall_result: overallResult,
      checked_by: user?.id ?? null,
      checked_at: new Date().toISOString(),
    })
    .eq("id", checkId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "gan_check.completed",
    entityType: "gan_quality_check",
    entityId: checkId,
    metadata: { result: overallResult },
  });

  revalidateGan(grnId);
  return { ok: true };
}
