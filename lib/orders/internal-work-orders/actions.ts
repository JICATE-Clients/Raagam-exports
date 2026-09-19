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
import {
  keptAccessoryLines,
  keptFabricLines,
  keptYarnLines,
  lineProblems,
} from "./lines";

type ActionResult = { ok: true } | { ok: false; error: string };
type SaveResult = { ok: true; iwoId: string } | { ok: false; error: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const LIST_PATH = "/orders/internal-work-orders";
const LINE_TABLES = ["iwo_yarn_items", "iwo_fabric_items", "iwo_accessory_items"] as const;

function headerOf(p: IwoParsed) {
  return {
    iwo_date: p.iwo_date,
    iwo_for: p.iwo_for,
    sales_order_id: p.sales_order_id,
    style_ref_no: p.style_ref_no || null,
    deli_date: p.deli_date || null,
    remarks: p.remarks || null,
  };
}

/**
 * Insert the lines of the header's kind, and each line's process rows.
 *
 * Blank rows are dropped by the SAME filters the Save gate used (`lines.ts`),
 * and `sno` is renumbered over what survives. Process rows are written only
 * after their line has an id; the line insert returns `sno` beside `id` so the
 * two are matched by position, never by the order PostgREST happened to return.
 */
async function writeLines(s: Db, iwoId: string, p: IwoParsed): Promise<ActionResult> {
  if (p.iwo_for === "yarn") {
    const lines = keptYarnLines(p.yarn);
    const { data, error } = await s
      .from("iwo_yarn_items")
      .insert(
        lines.map((l, i) => ({
          iwo_id: iwoId,
          sno: i + 1,
          item_id: l.item_id,
          stage_id: l.stage_id,
          planned_kgs: l.planned_kgs,
        })),
      )
      .select("id, sno");
    if (error) return { ok: false, error: error.message };
    const idBySno = new Map(((data ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]));
    const procs = lines.flatMap((l, i) =>
      l.processes.map((pr, j) => ({
        yarn_item_id: idBySno.get(i + 1),
        sno: j + 1,
        process_id: pr.process_id,
        shade_id: pr.shade_id,
        qty_kgs: pr.qty_kgs,
        rate_per_kg: pr.rate_per_kg,
      })),
    );
    if (procs.length) {
      const { error: pErr } = await s.from("iwo_yarn_process_details").insert(procs);
      if (pErr) return { ok: false, error: pErr.message };
    }
    return { ok: true };
  }

  if (p.iwo_for === "fabric") {
    const lines = keptFabricLines(p.fabric);
    const { data, error } = await s
      .from("iwo_fabric_items")
      .insert(
        lines.map((l, i) => ({
          iwo_id: iwoId,
          sno: i + 1,
          item_id: l.item_id,
          stage_id: l.stage_id,
          color_id: l.color_id,
          print_id: l.print_id,
          gsm: l.gsm,
          fabric_form: l.fabric_form,
          dia: l.dia || null,
          planned_kgs: l.planned_kgs,
        })),
      )
      .select("id, sno");
    if (error) return { ok: false, error: error.message };
    const idBySno = new Map(((data ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]));
    const procs = lines.flatMap((l, i) =>
      l.processes.map((pr, j) => ({
        fabric_item_id: idBySno.get(i + 1),
        sno: j + 1,
        process_id: pr.process_id,
        loss_pct: pr.loss_pct ?? 0,
        rate_per_kg: pr.rate_per_kg,
      })),
    );
    if (procs.length) {
      const { error: pErr } = await s.from("iwo_fabric_process_details").insert(procs);
      if (pErr) return { ok: false, error: pErr.message };
    }
    return { ok: true };
  }

  const lines = keptAccessoryLines(p.accessories);
  const { data, error } = await s
    .from("iwo_accessory_items")
    .insert(
      lines.map((l, i) => ({
        iwo_id: iwoId,
        sno: i + 1,
        item_id: l.item_id,
        specs: l.specs || null,
        color_id: l.color_id,
        size_id: l.size_id,
        uom_id: l.uom_id,
        planned_qty: l.planned_qty,
        is_advised: l.is_advised,
      })),
    )
    .select("id, sno");
  if (error) return { ok: false, error: error.message };
  const idBySno = new Map(((data ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]));
  const procs = lines.flatMap((l, i) =>
    l.processes.map((pr, j) => ({
      accessory_item_id: idBySno.get(i + 1),
      sno: j + 1,
      process_id: pr.process_id,
      vendor_id: pr.vendor_id,
      rate_per_unit: pr.rate_per_unit,
    })),
  );
  if (procs.length) {
    const { error: pErr } = await s.from("iwo_accessory_process_details").insert(procs);
    if (pErr) return { ok: false, error: pErr.message };
  }
  return { ok: true };
}

/** Every line of every kind — process rows go with them by cascade. */
async function clearLines(s: Db, iwoId: string): Promise<ActionResult> {
  for (const t of LINE_TABLES) {
    const { error } = await s.from(t).delete().eq("iwo_id", iwoId);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Create (`iwoId` null) or update an IWO, header and lines together.
 *
 * On UPDATE the lines are cleared FIRST, then the header is written, then the
 * new lines inserted: `iwo_line_guard` checks each line against the header's
 * `For`, so the header must already say the new kind when they arrive, and no
 * line of the old kind may still be standing when it changes.
 *
 * On CREATE a failed line insert deletes the header it just made, so a refused
 * save never leaves behind a numbered IWO with no lines. (Its number is spent —
 * the counter does not go back — which is the same trade every document number
 * in this app makes.)
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

  const problems = lineProblems(p);
  if (problems.length) return { ok: false, error: problems[0].message };

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
    const lines = await writeLines(supabase, data.id, p);
    if (!lines.ok) {
      await supabase.from("internal_work_orders").delete().eq("id", data.id);
      return lines;
    }
    await writeAudit({
      action: "internal_work_order.created",
      entityType: "internal_work_order",
      entityId: data.id,
    });
    revalidatePath(LIST_PATH);
    return { ok: true, iwoId: data.id };
  }

  const cleared = await clearLines(supabase, iwoId);
  if (!cleared.ok) return cleared;
  const { error } = await supabase
    .from("internal_work_orders")
    .update(headerOf(p))
    .eq("id", iwoId);
  if (error) return { ok: false, error: error.message };
  const lines = await writeLines(supabase, iwoId, p);
  if (!lines.ok) return lines;

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
  // Lines and their process rows cascade.
  const { error } = await supabase.from("internal_work_orders").delete().eq("id", iwoId);
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
