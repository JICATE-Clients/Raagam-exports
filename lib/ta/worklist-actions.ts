"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";

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
 * ## THIS TOUCHES THREE COLUMNS AND NOTHING ELSE, AND THAT IS LOAD-BEARING
 *
 * `writeChildren` — how the amendment saves its 20-odd child grids — DELETES
 * every child row and reinserts. The T&A table survives that only because the
 * amendment's writer merges `actual_date` / `status` / `notes` across by
 * `row_uid` (see §1.1 of the T&A contract, and the
 * `raagam-material-attribute-edit-orphans` memory for the day this repo paid for
 * that lesson: "12/12 lines + 10 answers destroyed and unrecoverable").
 *
 * So this action must never insert, never delete, and never write a column the
 * merge does not carry. It is a targeted `update` by primary key of exactly the
 * three columns the merge preserves. Anything more here would be a second writer
 * over the same rows, which is the shape of that bug.
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

/**
 * Record that an activity was completed.
 *
 * `actualDate` defaults to the LOCAL calendar date (`lib/calendar.ts` `today()`),
 * never `new Date().toISOString().slice(0,10)` — that is UTC, and a completion
 * logged at 02:00 in Tirupur would be filed under yesterday. It is also accepted
 * from the caller, because work is often logged the morning after it was done.
 */
export async function completeTaActivity(
  id: string,
  actualDate?: string,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No activity given" };

  const date = actualDate?.trim() || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Completion date must be a calendar date" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ actual_date: date, status: "done" })
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
 */
export async function reopenTaActivity(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No activity given" };

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ actual_date: null, status: "pending" })
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

/**
 * Register how many pieces have BYPASSED this activity ahead of its own
 * schedule (0540) — the shop-floor reality that Sewing's first 500 pieces
 * reach Checking and Ironing long before Sewing itself is marked `done`.
 *
 * INDEPENDENT OF `status`/`actual_date`, same as those two columns are of
 * each other — this never touches either, so a row can be `pending` and
 * carry a bypass, or `done` with none. Never a 4th `status` value (see the
 * 0540 migration header: the worklist buckets rows by exactly three states,
 * and a fourth spelling would put a row in none of them).
 *
 * CUMULATIVE, NOT AN INCREMENT — the caller sends the new running total (the
 * same shape `days_required` already uses: the operator's own figure, never
 * summed here), and `qty` REFUSES rather than clamps against the order's own
 * total pieces (`garment_order_amendment_styles.po_qty`, summed) — a guessed
 * ceiling is worse than an error the operator can act on.
 */
export async function registerBypass(id: string, qty: number): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No activity given" };
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Enter how many pieces have bypassed this activity" };
  }

  const supabase = await createClient();

  const { data: row, error: rowError } = await supabase
    .from(TABLE)
    .select("amendment_id")
    .eq("id", id)
    .maybeSingle();
  if (rowError) return { ok: false, error: rowError.message };
  if (!row) return { ok: false, error: "That T&A row no longer exists" };

  const { data: styles, error: styleError } = await supabase
    .from("garment_order_amendment_styles")
    .select("po_qty")
    .eq("amendment_id", row.amendment_id);
  if (styleError) return { ok: false, error: styleError.message };

  const orderQty = (styles ?? []).reduce((sum, s) => sum + (Number(s.po_qty) || 0), 0);
  if (orderQty <= 0) {
    return {
      ok: false,
      error: "This order has no pieces on its styles yet, so a bypass quantity has nothing to be measured against",
    };
  }
  if (qty > orderQty) {
    return {
      ok: false,
      error: `Cannot exceed the order's own ${orderQty} pieces`,
    };
  }

  const { error } = await supabase
    .from(TABLE)
    .update({ bypassed_qty: qty, bypassed_at: today() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
