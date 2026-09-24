import "server-only";
import { createClient } from "@/lib/supabase/server";
import { budgetFiguresOf, getOrderBudget } from "@/lib/orders/budget/service";
import { compareToBaseline, type BaselineRow, type BudgetBaseline } from "@/lib/orders/budget/amendment";

/**
 * LAST APPROVED vs LATEST, FOR THE MD'S PHONE (client 2026-09-24, "Revision
 * Approval & Mobile Comparison View").
 *
 * The desktop revision page (`getAmendmentEntry`) already answers this, beside
 * a dozen things an approval sheet does not need — Manual Entry Needed, the
 * BOM gaps, downstream documents, the timeline. This is its money half and
 * nothing else, through the SAME three calls: `getOrderBudget` →
 * `budgetFiguresOf` → `compareToBaseline`. So the figure the MD approves on
 * the phone is, row for row, the figure the revision page prints — there is
 * no second assembler here to drift.
 *
 * Loaded when the sheet opens, not with the queue: a budget's figures are
 * several reads, and a queue of twenty would pay for twenty comparisons
 * nobody opened.
 */
export type RevisionCompare =
  | { ok: true; rows: BaselineRow[] }
  | { ok: false; refused: string };

export async function loadRevisionCompare(entryId: string): Promise<RevisionCompare> {
  try {
    const s = await createClient();
    const { data, error } = await s
      .from("order_budget_revisions")
      .select("id, budget_id, baseline")
      .eq("id", entryId)
      .maybeSingle();
    if (error) return { ok: false, refused: `The revision could not be read — ${error.message}` };
    const r = data as { budget_id: string | null; baseline: unknown } | null;
    if (!r) return { ok: false, refused: "The revision no longer exists" };
    const baseline = (r.baseline as BudgetBaseline | null) ?? null;
    if (!baseline) return { ok: false, refused: "No Last Budget was recorded when this revision was raised" };
    if (!r.budget_id) return { ok: false, refused: "This revision has no budget yet" };

    const budget = await getOrderBudget(r.budget_id);
    if (!budget) return { ok: false, refused: "The budget no longer exists" };
    const figures = await budgetFiguresOf(budget);
    return { ok: true, rows: compareToBaseline(baseline, figures.general) };
  } catch (e) {
    return { ok: false, refused: e instanceof Error ? e.message : "The budget's figures could not be worked out" };
  }
}
