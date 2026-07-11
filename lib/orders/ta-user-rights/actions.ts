"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { taUserRightsInput, type TaUserRightsInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/** Keep only rows granting ≥1 action; blank rows are dropped. */
function normalizeRows(data: TaUserRightsInput) {
  return data.rows
    .filter((r) => r.can_view || r.can_add || r.can_modify || r.can_delete)
    .map((r) => ({
      activity_id: r.activity_id,
      can_view: r.can_view,
      can_add: r.can_add,
      can_modify: r.can_modify,
      can_delete: r.can_delete,
    }));
}

/** Replace a user's entire TA rights set (delete-all-then-reinsert). */
export async function setTaUserRights(data: TaUserRightsInput): Promise<Result> {
  if (!(await can("system_admin", "edit"))) return fail("Forbidden");
  const p = taUserRightsInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();

  const { error: delErr } = await s
    .from("ta_user_rights")
    .delete()
    .eq("user_id", p.data.user_id);
  if (delErr) return fail(delErr.message);

  const rows = normalizeRows(p.data);
  if (rows.length) {
    const { error } = await s
      .from("ta_user_rights")
      .insert(rows.map((r) => ({ ...r, user_id: p.data.user_id })));
    if (error) return fail(error.message);
  }

  await writeAudit({
    action: "ta_user_rights.set",
    entityType: "ta_user_rights",
    entityId: p.data.user_id,
  });
  revalidatePath("/orders/ta-user-rights");
  return { ok: true };
}
