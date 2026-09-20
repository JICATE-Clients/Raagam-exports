import { requirePermission, can } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getMyQueue, getStrandedRuns, canAct } from "@/lib/approvals/service";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { kpisFromJson } from "@/lib/orders/budget/amendment";
import type { CanActVerdict } from "@/lib/approvals/types";
import { withCreators } from "@/lib/created-by";
import { ifInstalled } from "@/lib/approvals/install";
import { sweepSlaOpportunistically } from "@/lib/approvals/sla";
import { ApprovalsNotInstalled } from "@/components/approvals/approvals-not-installed";
import {
  ApprovalsInboxScreen,
  type BudgetCard,
  type QueueRow,
} from "./approvals-inbox-screen";

/**
 * MY APPROVALS — the one queue, across every module.
 *
 * ## THE PAGE IS NOT GATED ON A PERMISSION, AND THAT IS DELIBERATE
 *
 * `requirePermission("approvals", "view")` here would be wrong: `approvals:view`
 * is the WIDE right — see every run in the business, for support — and gating
 * the inbox on it would lock every ordinary approver out of their own queue.
 *
 * The queue needs no permission because it cannot leak: `approval_my_queue`
 * returns only rows the caller is an eligible approver for, resolved by the same
 * `approval_step_approvers` predicate that `approval_can_act` uses. Someone with
 * nothing to approve sees an empty list, which is the honest answer rather than
 * a denial. So the gate is only "are you signed in".
 *
 * ONE PREDICATE, TWO READERS — the skill draws this as the shape of the whole
 * engine, and it is why the badge can never disagree with the list. Do NOT
 * filter this queue client-side for any reason: a row that is here is actionable
 * by definition, and the skill's troubleshooting table lists "badge count ≠ list
 * length" with exactly that cause.
 */
export default async function ApprovalsPage() {
  // Signed-in only. `requirePermission` with the module's own view right would
  // be the lockout described above; `dashboard:view` is what every signed-in
  // user in this app already holds.
  await requirePermission("dashboard", "view");

  /**
   * SWEEP BEFORE READING (0601), not after.
   *
   * A run that escalated a minute ago belongs in THIS render of the queue, not
   * the next one — an approver who opens their inbox and does not see the thing
   * that was just escalated to them has been told nothing. `sweepSla` never
   * throws and throttles itself to once a minute per instance, so the cost on
   * the ordinary load is one RPC that returns zeros.
   *
   * It is a NET, not the mechanism: `vercel.json`'s cron is what makes an
   * escalation happen while nobody is looking. See `lib/approvals/sla.ts`.
   */
  await sweepSlaOpportunistically();

  /* Same guard as the flows route — the queue RPC does not exist until 0502 is
     applied, and an inbox that crashes is a worse answer than one that says the
     engine is not installed. */
  const [queue, viewAll] = await Promise.all([
    ifInstalled(() => getMyQueue()),
    can("approvals", "view"),
  ]);
  if (queue === null) return <ApprovalsNotInstalled />;

  /**
   * THE STRANDED BANNER IS FOR SUPPORT, NOT FOR APPROVERS.
   *
   * A stranded run is an open run whose current step resolves to nobody — the
   * single highest-cost defect the skill records, because it raises no error and
   * is chased by no one. It is also unactionable by an ordinary approver: they
   * are by definition not on it. So the view is read only for someone holding
   * `approvals:view`, and skipped entirely otherwise rather than fetched and
   * hidden — the RLS would return it either way, and a query nobody renders is
   * a query nobody should run.
   */
  const stranded = viewAll ? ((await ifInstalled(() => getStrandedRuns())) ?? []) : [];

  /**
   * THE CREATED PAIR, THROUGH THE APP'S OWN HELPER — not a special case.
   *
   * AGENTS.md requires every listing to end with Created Date + Created User,
   * and this listing already holds both facts under the engine's names:
   * `started_at` is when the request was raised and `requested_by` is who raised
   * it. A run's creator IS its requester, so the pair is not being approximated
   * — it is being renamed to the two keys `withCreators` and `withCreatedColumns`
   * read.
   *
   * That matters more than tidiness. `creatorName()` refuses to print anything
   * uuid-shaped, so handing the raw `requested_by` to the table would give the
   * right column, correctly wired, with a dash in every row — the failure
   * AGENTS.md records as the one that hides. `withCreators` resolves the names
   * through `creator_names()` (SECURITY DEFINER), which is the only way that
   * works: `profiles_read_own` lets a user read only their OWN profile, so an
   * embed would resolve to null for every request raised by anybody else.
   */
  const rows: QueueRow[] = await withCreators(
    queue.items.map((q) => ({
      ...q,
      created_at: q.started_at,
      created_by: q.requested_by,
    })),
  );

  return (
    <ApprovalsInboxScreen
      rows={rows}
      stranded={stranded}
      canViewAll={viewAll}
      budgets={await budgetCards(rows)}
      verdicts={await queueVerdicts(rows)}
    />
  );
}

/**
 * THE FIGURES THE PHONE CARD SHOWS — `doc/order/newfeature.md` §2.
 *
 * "Approvers view high-level budget metrics (Order Qty, Gross Sales, Total
 * Expenses, Profit %, Profit Value) in a clean card format."
 *
 * ## READ FROM `submitted_summary`, NEVER RECOMPUTED
 *
 * That column is the §4.2 snapshot `submitBudget` stores in the same write as
 * the status — the figures AS SUBMITTED. Recomputing them here would be a
 * second assembler for one number, and the MD would be approving a total the
 * merchandiser never saw. It is also what the desktop screen and the push
 * notification both read, so all three say the same thing by construction.
 *
 * ## ONE QUERY FOR THE WHOLE QUEUE
 *
 * Not one per card. A queue of twenty budgets is twenty round trips on a
 * phone's connection, and the inbox already renders without any of this — the
 * figures are an enrichment, so a failure returns an empty map and the cards
 * fall back to naming the document.
 */
async function budgetCards(rows: QueueRow[]): Promise<Record<string, BudgetCard>> {
  const ids = rows
    .filter((r) => r.workflow_key === WORKFLOWS.order_budget.key)
    .map((r) => r.subject_id);
  if (ids.length === 0) return {};
  try {
    const s = await createClient();
    const { data, error } = await s
      .from("order_budgets")
      .select("id, code, currency_code, submitted_summary")
      .in("id", ids);
    if (error) {
      console.error("[approvals] budget cards:", error.message);
      return {};
    }
    const out: Record<string, BudgetCard> = {};
    for (const b of (data ?? []) as {
      id: string;
      code: string | null;
      currency_code: string | null;
      submitted_summary: unknown;
    }[]) {
      out[b.id] = {
        code: b.code,
        currency: b.currency_code,
        kpis: kpisFromJson(b.submitted_summary),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * MAY I ACT ON THIS ONE — the real verdict, per row.
 *
 * ## WHY THIS IS NOT ASSUMED FROM BEING IN THE QUEUE
 *
 * It nearly could be: both readers resolve through `approval_step_approvers`.
 * But `approval_can_act` asks ONE question more — a step may additionally
 * demand a `required_permission`, and the queue RPC does not test it. A row
 * can therefore be in your list and still refuse you, which is precisely the
 * case where synthesising `can_act: true` would put a button in front of
 * somebody the database is about to reject.
 *
 * So it is asked properly, in parallel, and a failure yields no verdict — the
 * card then shows the figures and no buttons, which is the safe direction.
 */
async function queueVerdicts(rows: QueueRow[]): Promise<Record<string, CanActVerdict>> {
  const out: Record<string, CanActVerdict> = {};
  await Promise.all(
    rows.map(async (r) => {
      try {
        const v = await canAct(r.run_id);
        if (v?.can_act) out[r.run_id] = v;
      } catch {
        /* one row's verdict failing must not empty the whole inbox */
      }
    }),
  );
  return out;
}
