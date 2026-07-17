"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";

// ============================================================================
// Approve Costing (Planning) — approve / reject a FINALISED Sales quote_costing.
// Mirrors budget-actions.approveBudget/rejectBudget. Cross-module write is
// granted by the quote_costings_planning_approve RLS policy (0278).
// ============================================================================

type Err = { ok: false; error: string };
type R = { ok: true } | Err;

function revalidateCosting(): void {
  revalidatePath("/planning/approve-costing");
  revalidatePath("/sales/quote-costings");
  revalidatePath("/planning");
}

export async function approveCosting(id: string, reason?: string): Promise<R> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("quote_costings")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "finalised")
    return { ok: false, error: "Only finalised costings can be approved" };

  const user = await getAppUser();
  const { error } = await supabase
    .from("quote_costings")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
      approval_reason: reason?.trim() || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "quote_costing.approved",
    entityType: "quote_costing",
    entityId: id,
  });
  revalidateCosting();
  return { ok: true };
}

export async function rejectCosting(id: string, reason?: string): Promise<R> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("quote_costings")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.status !== "finalised")
    return { ok: false, error: "Only finalised costings can be rejected" };

  const user = await getAppUser();
  const { error } = await supabase
    .from("quote_costings")
    .update({
      status: "rejected",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
      approval_reason: reason?.trim() || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "quote_costing.rejected",
    entityType: "quote_costing",
    entityId: id,
  });
  revalidateCosting();
  return { ok: true };
}
