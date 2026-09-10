"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { stageWipByPair, type StageWip } from "@/lib/production/service";
import type { ProductionStage } from "@/lib/production/types";

/**
 * Marking a T&A activity done, from the worklist.
 *
 * ## Why the write lives HERE and not on the order's T&A tab
 *
 * `actual_date` is entered days or weeks after the order was saved, by the
 * department that did the work — not by the merchandiser who typed the plan. Put
 * the completion on the order tab and completing it means opening the order,
 * which is the friction that killed legacy T&A.
 *
 * ## THIS TOUCHES ONLY COLUMNS THE MERGE ALSO CARRIES, AND THAT IS LOAD-BEARING
 *
 * `writeChildren` — how the amendment saves its 20-odd child grids — DELETES
 * every child row and reinserts. The T&A table survives that only because the
 * amendment's writer merges `actual_date` / `status` / `notes` /
 * `assigned_staff_id` / `delay_attribution` (0547) across by `row_uid` (see
 * §1.1 of the T&A contract, `mergeTaCompletions` in
 * `lib/orders/amendments/types.ts`, and the
 * `raagam-material-attribute-edit-orphans` memory for the day this repo paid for
 * that lesson: "12/12 lines + 10 answers destroyed and unrecoverable").
 *
 * So every action in this file must write ONLY columns the merge carries. It is
 * a targeted `update` by primary key of exactly those columns. Writing anything
 * the merge does not know about would be a second writer over the same rows,
 * which is the shape of that bug — and the reason `assignTaActivity` /
 * `delayAttribution` below were added to `TaCompletion` in the SAME change that
 * added them here, not as a follow-up.
 *
 * ## No RPC, so no function grant to get wrong
 *
 * Straight PostgREST through the user's own session, so the table's RLS (module
 * `orders`) is the enforcement and there is no `SECURITY DEFINER` function to be
 * born anon-callable by two independent grants (AGENTS.md, "Function grants").
 * The `can()` check below is the courteous half; RLS is the guard.
 */

type Result = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/orders/ta-worklist";

const TABLE = "garment_order_amendment_ta_activities";

const DELAY_ATTRIBUTIONS = ["none", "internal_staff", "buyer_delay", "material_supplier"] as const;
type DelayAttribution = (typeof DELAY_ATTRIBUTIONS)[number];

/**
 * Record that an activity was completed.
 *
 * `actualDate` defaults to the LOCAL calendar date (`lib/calendar.ts` `today()`),
 * never `new Date().toISOString().slice(0,10)` — that is UTC, and a completion
 * logged at 02:00 in Tirupur would be filed under yesterday. It is also accepted
 * from the caller, because work is often logged the morning after it was done.
 *
 * `delayAttribution` (0547) is required only when the completion is LATE —
 * `staff_ta_kpi`'s on-time score reads it, and an unattributed late row would
 * count against the assignee by default (`delay_attribution`'s own column
 * default is `'none'`, not "unknown"), which is the wrong direction to fail
 * silently in. Reading `target_date` here (one extra row, by primary key) is
 * the courtesy check; the CHECK constraint (0547) is what actually refuses a
 * 5th spelling — this only refuses a MISSING one on a late row, which no
 * constraint can express.
 */
export async function completeTaActivity(
  id: string,
  actualDate?: string,
  delayAttribution?: DelayAttribution,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No activity given" };

  const date = actualDate?.trim() || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Completion date must be a calendar date" };
  }
  if (delayAttribution && !DELAY_ATTRIBUTIONS.includes(delayAttribution)) {
    return { ok: false, error: "Unrecognised delay attribution" };
  }

  const supabase = await createClient();

  const { data: row, error: rowError } = await supabase
    .from(TABLE)
    .select("target_date")
    .eq("id", id)
    .maybeSingle();
  if (rowError) return { ok: false, error: rowError.message };
  if (!row) return { ok: false, error: "That T&A row no longer exists" };

  const isLate = row.target_date != null && date > row.target_date;
  if (isLate && (!delayAttribution || delayAttribution === "none")) {
    return {
      ok: false,
      error: "This is late — say who it was on (Staff / Buyer / Material Supplier) before marking it done",
    };
  }

  const { error } = await supabase
    .from(TABLE)
    .update({
      actual_date: date,
      status: "done",
      delay_attribution: isLate ? delayAttribution : "none",
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/**
 * Undo a completion — back to open, with the date cleared.
 *
 * Present because the alternative to an undo is an operator who marked the wrong
 * row and now needs someone with database access. `status` goes back to
 * `pending` rather than `in_progress`: the row is being disclaimed, and claiming
 * it is half-done would be inventing a fact.
 *
 * `delay_attribution` resets to `'none'` alongside `actual_date`/`status`
 * (0547) — it describes a completion, and a row with no completion has
 * nothing for it to describe. Leaving a stale `'buyer_delay'` on a reopened,
 * not-yet-redone row would misattribute whatever the NEXT completion turns
 * out to be.
 */
export async function reopenTaActivity(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No activity given" };

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ actual_date: null, status: "pending", delay_attribution: "none" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/**
 * Claim (or release) a T&A row for one specific person (0547).
 *
 * `staffId: null` releases the row back to "every eligible department
 * member's" — the same absence `garment_order_amendment_ta_activities.
 * assigned_staff_id is null` already means everywhere else this column is
 * read (`lib/ta/worklist.ts`).
 *
 * DELIBERATELY NOT DEPARTMENT-LOCKED. The T&A Worklist UI scopes the picker's
 * OPTIONS to the row's own department (the same `activityDepartments()` /
 * `myDepartment()` logic `getWorklist` already uses), but this action itself
 * only checks `orders:edit` — assigning does not grant anyone new access, it
 * is routing information, and a hard department lock here would block the
 * legitimate case of one department genuinely lending a hand on another's
 * activity. If that ever needs to become a real boundary, it belongs in RLS,
 * not as a second copy of the department-matching logic here.
 */
export async function assignTaActivity(id: string, staffId: string | null): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No activity given" };

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ assigned_staff_id: staffId })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/**
 * THE CUTTING ROOM SAFETY LOCK (doc/approval.md §5.2) — checked here, not on
 * a dedicated cutting screen, because none exists in this app yet (research,
 * 2026-09-07: no "generate a fabric cut sheet" or "start cutting" screen
 * anywhere). Starting the CUTTING row on the T&A Worklist is the closest
 * real, already-built proxy for "cutting begins" today.
 *
 * MATCHED BY `short_name` CONVENTION, never a foreign key — the same
 * convention `lib/orders/amendments/actions.ts` already uses to bridge PP
 * Sample into the production ladder. Refuses rather than silently starting
 * the activity anyway; the UI additionally disables the Start button for the
 * same reason (belt and braces), but the actual guard is here.
 */
async function cuttingBlockedReason(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
): Promise<string | null> {
  // PRODUCTION-BASED PP APPROVAL (0552, §3) — the order's own opt-out. NO
  // decouples cutting from PP Sample review entirely, so nothing below this
  // line runs: not "the tracker doesn't block", but "this order doesn't ask
  // the question at all", same as a database with no PP Sample master row.
  const { data: order } = await s
    .from("garment_order_amendments")
    .select("production_based_pp_approval")
    .eq("id", amendmentId)
    .maybeSingle();
  if (order && order.production_based_pp_approval === false) return null;

  const { data: approval, error } = await s
    .from("ta_approvals")
    .select("id")
    .ilike("short_name", "PPSAMPLE")
    .maybeSingle();
  // No PP Sample milestone in this database at all — nothing to gate on, so
  // cutting is not blocked. A missing master row is a setup gap elsewhere,
  // not a reason to freeze every order's cutting activity.
  if (error || !approval) return null;

  const { data: tracker } = await s
    .from("garment_order_amendment_ta_approvals")
    .select("status")
    .eq("amendment_id", amendmentId)
    .eq("approval_id", approval.id)
    .maybeSingle();
  // No tracker row means this order's Approvals policy never asked for a PP
  // Sample — nothing to wait on, so cutting is not blocked. The lock is
  // "cutting waits for PP Sample IF the order tracks one", never "every
  // order must track one" — that is the Customer Policy Mapping's decision,
  // not this guard's to second-guess.
  if (!tracker) return null;
  if (tracker.status !== "approved") {
    return "Cutting is locked until PP Sample is Approved on the Approvals Worklist.";
  }
  return null;
}

/** Move a row to in-progress without claiming it is finished. */
export async function startTaActivity(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No activity given" };

  const supabase = await createClient();

  const { data: row, error: rowError } = await supabase
    .from(TABLE)
    .select("amendment_id, activity:ta_activities(short_name)")
    .eq("id", id)
    .maybeSingle();
  if (rowError) return { ok: false, error: rowError.message };
  if (!row) return { ok: false, error: "That T&A row no longer exists" };

  const activity = Array.isArray(row.activity) ? row.activity[0] : row.activity;
  if (activity?.short_name?.toUpperCase() === "CUT") {
    const blocked = await cuttingBlockedReason(supabase, row.amendment_id);
    if (blocked) return { ok: false, error: blocked };
  }

  const { error } = await supabase
    .from(TABLE)
    .update({ status: "in_progress" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

// `registerBypass` (hand-typed bypassed_qty/bypassed_at, 0540) lived here and
// is gone as of 0548 — bypass is now DERIVED from `production_entries` via
// `stage_cumulative_good_qty`, computed live in `lib/ta/worklist.ts`
// `getWorklist()`, so the T&A worklist and the floor ledger can never
// disagree the way a hand-typed running total could. The `bypassed_qty`/
// `bypassed_at` columns stay on the table for their existing history; nothing
// writes to them any more.

/**
 * The same derived bypass figure `getWorklist()` shows, for Order Entry's own
 * T&A tab (`garment-order-screen.tsx`) — the client asked for it there
 * directly rather than only on the separate worklist screen.
 *
 * Gated on `orders:view`, NOT `production:view` — this is read from an
 * `orders`-scoped screen, by whoever can already see the order, and
 * `stage_cumulative_good_qty` is SECURITY DEFINER (0548) precisely so a user
 * with no `production` permission still gets an honest answer rather than a
 * silent zero from RLS.
 *
 * Returns a plain object keyed by STAGE, not by T&A row — the caller (one
 * amendment's own ladder) maps each of its rows to a stage and looks up this
 * object, the same "keyed by the fact, not the row" shape `taActivityById`
 * already uses for the activity master.
 */
export async function getTaActivityWip(
  amendmentId: string,
  stages: ProductionStage[],
): Promise<Partial<Record<ProductionStage, StageWip>>> {
  if (!(await can("orders", "view"))) return {};
  const uniqueStages = [...new Set(stages)];
  if (!amendmentId || !uniqueStages.length) return {};

  const wip = await stageWipByPair(uniqueStages.map((stage) => ({ amendmentId, stage })));
  const out: Partial<Record<ProductionStage, StageWip>> = {};
  for (const stage of uniqueStages) {
    const v = wip.get(`${amendmentId}|${stage}`);
    if (v) out[stage] = v;
  }
  return out;
}
