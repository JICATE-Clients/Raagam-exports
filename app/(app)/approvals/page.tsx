import { requirePermission, can } from "@/lib/auth/server";
import { getMyQueue, getStrandedRuns } from "@/lib/approvals/service";
import { withCreators } from "@/lib/created-by";
import { ifInstalled } from "@/lib/approvals/install";
import { ApprovalsNotInstalled } from "@/components/approvals/approvals-not-installed";
import { ApprovalsInboxScreen, type QueueRow } from "./approvals-inbox-screen";

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

  return <ApprovalsInboxScreen rows={rows} stranded={stranded} canViewAll={viewAll} />;
}
