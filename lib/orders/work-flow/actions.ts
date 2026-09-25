"use server";

import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import {
  WORK_FLOW_CODES,
  workFlowDay0,
  type WorkFlowCode,
  type WorkFlowDay0,
  type WorkFlowEmployee,
  type WorkFlowRow,
} from "./types";

/**
 * Order Entry ▸ T&A ▸ Work Flow — load and edit (0607).
 *
 * ## WHY THE PANEL SAVES ITS OWN ROWS, NOT THE ORDER'S SAVE
 *
 * The six rows belong to the RE, live in their own table, and are never part of
 * the order's payload (see 0607's header for why: the ladder's delete-and-
 * reinsert). So an Owner / Days / Remarks change is written the moment it is
 * made, like the TA Followup tab's actions — and the order's own Save neither
 * carries nor can clobber them.
 *
 * ## ONLY THREE COLUMNS CAN BE WRITTEN, AND RLS + GRANTS SAY SO, NOT THIS FILE
 *
 * `authenticated` holds UPDATE on `days`, `owner_id` and `remarks` and nothing
 * else (0607 §7). `status` / `actual_date` belong to the module triggers. The
 * `can()` checks here are the courteous half; the grants are the guard.
 */

type Fail = { ok: false; error: string };

export type WorkFlowLoad =
  | {
      ok: true;
      /** The RE this order belongs to — the rows' key. */
      salesOrderId: string;
      day0: WorkFlowDay0;
      /** Tirupur today (`lib/calendar.ts`), from the SERVER — a render must not read the clock (React Compiler), and "overdue" is a question about one day for every row. */
      today: string;
      rows: WorkFlowRow[];
      employees: WorkFlowEmployee[];
    }
  | Fail;

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * The six rows for the RE this document belongs to, plus Day 0 (read off the
 * RE's ORIGINAL document, as 0607's `work_flow_day0` does) and the employee
 * list the owner pickers narrow.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — every read below returns its
 * error, because "no milestones" would read as a real, unremarkable answer.
 */
export async function loadWorkFlow(amendmentId: string): Promise<WorkFlowLoad> {
  if (!amendmentId) return { ok: false, error: "Save the order first — the Work Flow starts when the order exists." };
  const s = await createClient();

  // THE PERMISSION CHECK RIDES ALONGSIDE THE FIRST READ (2026-09-25, "T&A tab
  // shows Loading"). Every round trip is ~260 ms and they were three in a row;
  // the read is RLS-scoped, so fetching it before the answer is known leaks
  // nothing — the result is simply discarded on a refusal.
  const [allowed, { data: doc, error: docErr }] = await Promise.all([
    can("orders", "view"),
    s.from("garment_order_amendments").select("sales_order_id").eq("id", amendmentId).maybeSingle(),
  ]);
  if (!allowed) return { ok: false, error: "Forbidden" };
  if (docErr) return { ok: false, error: docErr.message };
  const salesOrderId = str((doc as Row | null)?.sales_order_id);
  if (!salesOrderId) return { ok: false, error: "This order has no RE No yet, so it has no Work Flow." };

  const [first, rowsRes, empRes] = await Promise.all([
    s
      .from("garment_order_amendments")
      .select("received_date, amend_date")
      .eq("sales_order_id", salesOrderId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle(),
    s
      .from("order_work_flow_milestones")
      .select(
        "id, code, sn, days, target_date, actual_date, status, actual_source, owner_id, remarks, " +
          "owner:employees!owner_id(name)",
      )
      .eq("sales_order_id", salesOrderId)
      .order("sn", { ascending: true }),
    s
      .from("employees")
      // `designation_id` and `department_id` BOTH point at config_lookups, so a
      // bare embed is ambiguous (AGENTS.md "A SECOND FK BREAKS EVERY EXISTING
      // EMBED") — each names its column.
      .select(
        "id, code, name, inactive, " +
          "designation:config_lookups!designation_id(name), department:config_lookups!department_id(name)",
      )
      .order("name", { ascending: true }),
  ]);
  if (first.error) return { ok: false, error: first.error.message };
  if (rowsRes.error) return { ok: false, error: rowsRes.error.message };
  if (empRes.error) return { ok: false, error: empRes.error.message };

  const f = first.data as Row | null;
  const day0 = workFlowDay0(str(f?.received_date), str(f?.amend_date));

  const codes = new Set<string>(WORK_FLOW_CODES);
  const rows: WorkFlowRow[] = ((rowsRes.data ?? []) as unknown as Row[])
    .filter((r) => codes.has(String(r.code)))
    .map((r) => ({
      id: String(r.id),
      code: r.code as WorkFlowCode,
      sn: Number(r.sn),
      days: Number(r.days),
      target_date: str(r.target_date),
      actual_date: str(r.actual_date),
      status: (r.status as WorkFlowRow["status"]) ?? "pending",
      actual_source: (str(r.actual_source) as WorkFlowRow["actual_source"]) ?? null,
      owner_id: str(r.owner_id),
      owner_name: str((r.owner as Row | null)?.name),
      remarks: str(r.remarks),
    }));

  const employees: WorkFlowEmployee[] = ((empRes.data ?? []) as unknown as Row[]).map((e) => ({
    id: String(e.id),
    code: str(e.code),
    name: String(e.name ?? ""),
    inactive: e.inactive === true,
    designation: str((e.designation as Row | null)?.name),
    department: str((e.department as Row | null)?.name),
  }));

  return { ok: true, salesOrderId, day0, today: today(), rows, employees };
}

export type WorkFlowPatch = {
  days?: number;
  owner_id?: string | null;
  remarks?: string | null;
};

/**
 * Change one milestone's Days, Owner or Remarks. A Days change re-dates the row
 * in the database (0607's BEFORE trigger) and re-arms its overdue alert; the
 * returned row is what the panel shows next, so the screen never computes a
 * stored target on its own.
 */
export async function updateWorkFlowMilestone(
  id: string,
  patch: WorkFlowPatch,
): Promise<{ ok: true; target_date: string | null } | Fail> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No milestone given" };

  const write: Record<string, unknown> = {};
  if (patch.days !== undefined) {
    if (!Number.isInteger(patch.days) || patch.days < 0 || patch.days > 365) {
      return { ok: false, error: "Days must be a whole number from 0 to 365" };
    }
    write.days = patch.days;
  }
  if (patch.owner_id !== undefined) write.owner_id = patch.owner_id || null;
  if (patch.remarks !== undefined) {
    const r = (patch.remarks ?? "").trim();
    write.remarks = r ? r.toUpperCase() : null;
  }
  if (!Object.keys(write).length) return { ok: false, error: "Nothing to change" };

  const s = await createClient();
  const { data, error } = await s
    .from("order_work_flow_milestones")
    .update(write)
    .eq("id", id)
    .select("target_date")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  // RLS filters an unauthorised update to ZERO rows, not an error — say so
  // rather than reporting a save that did not happen.
  if (!data) return { ok: false, error: "The milestone could not be updated (it may have been removed, or you lack edit permission on orders)." };
  return { ok: true, target_date: str((data as Row).target_date) };
}
