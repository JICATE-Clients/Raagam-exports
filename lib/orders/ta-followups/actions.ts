"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { TA_FOLLOWUP_STATUSES, type TaFollowupStatus } from "./types";

type Result = { ok: true } | { ok: false; error: string };

/** Record followup progress (actuals + status + remarks) on one TA-plan activity. */
export async function updateTaFollowup(
  id: string,
  patch: {
    status?: TaFollowupStatus;
    actual_date?: string | null;
    description?: string | null;
    notes?: string | null;
  },
): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };

  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!TA_FOLLOWUP_STATUSES.includes(patch.status)) {
      return { ok: false, error: "Invalid status" };
    }
    update.status = patch.status;
  }
  if (patch.actual_date !== undefined) update.actual_date = patch.actual_date || null;
  if (patch.description !== undefined) update.description = patch.description?.trim() || null;
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;

  if (Object.keys(update).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("ta_plan_activities")
    .update(update)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "ta_followup.updated",
    entityType: "ta_plan_activity",
    entityId: id,
  });
  revalidatePath("/orders/ta-followups");
  return { ok: true };
}
