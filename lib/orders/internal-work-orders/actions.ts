"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { resolveWriteLocation } from "@/lib/auth/location";
import { writeAudit } from "@/lib/audit";
import {
  iwoInput,
  IWO_STATUSES,
  type IwoInput,
  type IwoParsed,
  type IwoStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type SaveResult = { ok: true; iwoId: string } | { ok: false; error: string };

const LIST_PATH = "/orders/internal-work-orders";

function headerOf(p: IwoParsed) {
  return {
    iwo_date: p.iwo_date,
    iwo_for: p.iwo_for,
    // 0597: the Reference is typed. `sales_order_id` and `style_ref_no` are
    // NOT written, so a value an older row holds is kept as it was.
    reference_no: p.reference_no || null,
    deli_date: p.deli_date || null,
    remarks: p.remarks || null,
  };
}

/**
 * Create (`iwoId` null) or update an IWO — THE HEADER ONLY (2026-09-19).
 *
 * What an IWO procures is planned on its BOM (IWO Fabric BOM for Yarn / Fabric,
 * IWO Material BOM for Accessories), so this writes one row and no lines.
 * Changing For once a BOM exists is refused by `iwo_for_lock` (0582 / 0584 /
 * 0585) — its message is returned as-is, since it names the fix.
 */
export async function saveInternalWorkOrder(
  iwoId: string | null,
  payload: IwoInput,
): Promise<SaveResult> {
  if (!(await can("orders", iwoId ? "edit" : "create"))) {
    return { ok: false, error: "Forbidden" };
  }
  const parsed = iwoInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const p = parsed.data;
  const supabase = await createClient();

  if (!iwoId) {
    // The unit comes from the session, never the form — a rule at the call
    // site is a rule the next call site can forget.
    const loc = await resolveWriteLocation();
    if (!loc.ok) return { ok: false, error: loc.error };

    const { data, error } = await supabase
      .from("internal_work_orders")
      .insert({ ...headerOf(p), location_id: loc.locationId })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Failed to create work order" };
    }
    await writeAudit({
      action: "internal_work_order.created",
      entityType: "internal_work_order",
      entityId: data.id,
    });
    revalidatePath(LIST_PATH);
    return { ok: true, iwoId: data.id };
  }

  const { error } = await supabase
    .from("internal_work_orders")
    .update(headerOf(p))
    .eq("id", iwoId);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "internal_work_order.updated",
    entityType: "internal_work_order",
    entityId: iwoId,
  });
  revalidatePath(LIST_PATH);
  return { ok: true, iwoId };
}

/**
 * The I.WO No a new work order dated `iwoDate` WOULD receive — so the box shows
 * U2/IWO/2627/0005 while it is being entered, as the legacy screen does.
 *
 * THE DATABASE COMPOSES IT (`peek_iwo_number`, 0580), sharing `iwo_no_format()`
 * and `fiscal_year_segment()` with the trigger that assigns; building the
 * string here would be a second copy of both. The unit comes from
 * `resolveWriteLocation()` — the SAME call `saveInternalWorkOrder` stamps the
 * row with — so the preview and the saved number count at one unit.
 *
 * A prediction, not a reservation: nothing is consumed, and two operators
 * entering at once at one unit see the same number until one saves. Null when
 * there is no unit or the read is refused; the box is then simply blank.
 */
export async function previewIwoNumber(iwoDate: string | null): Promise<string | null> {
  if (!(await can("orders", "create"))) return null;
  const loc = await resolveWriteLocation();
  if (!loc.ok) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("peek_iwo_number", {
    p_location_id: loc.locationId,
    p_on: iwoDate && iwoDate.trim() ? iwoDate : null,
  });
  if (error) return null;
  return typeof data === "string" && data ? data : null;
}

export async function deleteInternalWorkOrder(iwoId: string): Promise<ActionResult> {
  if (!(await can("orders", "delete"))) return { ok: false, error: "Forbidden" };
  const supabase = await createClient();
  // Its BOM (Fabric or Material) cascades with it. A purchase order line bought
  // for it does NOT (0586, ON DELETE RESTRICT): the delete is refused, and said
  // in words rather than as Postgres's foreign-key sentence.
  const { error } = await supabase.from("internal_work_orders").delete().eq("id", iwoId);
  if (error?.code === "23503") {
    return {
      ok: false,
      error: "Purchase orders have been raised for this work order, so it cannot be deleted. Cancel it instead.",
    };
  }
  if (error) return { ok: false, error: error.message };
  await writeAudit({
    action: "internal_work_order.deleted",
    entityType: "internal_work_order",
    entityId: iwoId,
  });
  revalidatePath(LIST_PATH);
  return { ok: true };
}

// ---------- status transitions ----------

export async function setIwoStatus(
  iwoId: string,
  status: IwoStatus,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    return { ok: false, error: "Forbidden" };
  }
  if (!IWO_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "issued") patch.issued_at = new Date().toISOString();

  const { error } = await supabase
    .from("internal_work_orders")
    .update(patch)
    .eq("id", iwoId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeAudit({
    action: `internal_work_order.${status}`,
    entityType: "internal_work_order",
    entityId: iwoId,
  });

  revalidatePath(LIST_PATH);
  return { ok: true };
}
