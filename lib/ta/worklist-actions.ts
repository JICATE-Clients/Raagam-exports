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

/** Move a row to in-progress without claiming it is finished. */
export async function startTaActivity(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!id) return { ok: false, error: "No activity given" };

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ status: "in_progress" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
