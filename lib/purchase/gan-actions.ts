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

  /* THE RESULT REACHES THE GRN LINE (grn-plan.md Phase 4). A quality check named a line
     and its verdict, but nothing carried the verdict back, so the line kept "Pending" and
     the keeper re-typed it — or did not. While the GRN is still a draft, the line's QC
     status follows the check: pass → Passed, fail → Failed, conditional → Partial. The
     REJECTED QTY is still the keeper's to enter (a check says the goods failed, not how
     many) — the GRN page flags a Failed line with nothing rejected. A posted GRN is left
     as posted. */
  const { data: chk } = await supabase.from("gan_quality_checks").select("grn_line_id").eq("id", checkId).maybeSingle();
  const lineId = (chk as { grn_line_id: string | null } | null)?.grn_line_id;
  if (lineId) {
    const { data: g } = await supabase.from("grns").select("status").eq("id", grnId).maybeSingle();
    if ((g as { status: string } | null)?.status === "draft") {
      const qc = overallResult === "pass" ? "passed" : overallResult === "fail" ? "failed" : "partial";
      const { error: lineErr } = await supabase.from("grn_line_items").update({ qc_status: qc }).eq("id", lineId).eq("grn_id", grnId);
      if (lineErr) return { ok: false, error: `Check saved, but the GRN line's QC status was not: ${lineErr.message}` };
      revalidatePath(`/purchase/grn/${grnId}`);
    }
  }

  await writeAudit({
    action: "gan_check.completed",
    entityType: "gan_quality_check",
    entityId: checkId,
    metadata: { result: overallResult },
  });

  revalidateGan(grnId);
  return { ok: true };
}
