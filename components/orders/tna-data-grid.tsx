/**
 * T&A LADDER ▸ the milestone grid.
 *
 * `DataTable` (`components/ui/data-table.tsx`), NOT `ChildGrid` and not a
 * hand-rolled `<table>`. Three reasons, and the third is the one a reader is
 * most likely to get wrong:
 *
 * - This is a LISTING, not a typing surface. `ChildGrid` is the app's editable
 *   grid — it seeds a blank row, claims Tab along the row and Ctrl+Del on a
 *   cell. A read-only view that borrowed it would offer an operator a "+ Add"
 *   and a row ✕ for rows this screen cannot write.
 * - `DataTable` already carries the responsive half: `hidden md:table` with
 *   stacked cards beneath it, so a phone gets label/value pairs rather than a
 *   sideways scroll, and this file does not have to state a second layout.
 * - AGENTS.md's "Editable sub-tables open with a row" does NOT apply here, and
 *   it names this exact case as exempt: "a read-only table". An empty ladder
 *   really is empty — seeding a blank rung would put a row on screen that the
 *   ladder does not contain and that nothing can fill in.
 *
 * ## NO CREATED DATE / CREATED USER COLUMNS
 *
 * The standing rule is that every LISTING shows who made the row and when. A
 * ladder rung is a line item of the order document, and AGENTS.md exempts those
 * by path: "a PO line has no creator worth a column; the document above it does,
 * and its detail page shows that". The rung's provenance is the order's.
 */

import { DataTable, type Column } from "@/components/ui/data-table";
import { TnaStatusBadge } from "@/components/orders/tna-status-badge";
import { fmtDate } from "@/lib/format";
import { tnaDaysLate, tnaDisplayState, type TnaMilestone } from "@/lib/orders/ta/tna-types";

export function TnaDataGrid({
  rows,
  /**
   * TODAY, PASSED IN — never read here.
   *
   * Every rung on the screen has to be judged against the same date as the
   * counts above it, or the card can say `Delayed 3` over four red rows with
   * nothing on screen to say which is right. `today()` (lib/calendar.ts) is
   * pinned to Asia/Kolkata, so the value is stable between a server render and
   * the browser — it is passed for agreement between the two halves, not to
   * dodge a hydration mismatch.
   */
  today,
  /** Drop the table's own border/background when nesting inside a `<Card>`. */
  bare = false,
}: {
  rows: readonly TnaMilestone[];
  today: string;
  bare?: boolean;
}) {
  /**
   * THE RUNG'S NUMBER IS ITS POSITION, and that is the contract rather than a
   * convenience. `order-ladder.ts` is explicit that the ladder is the operator's
   * sequence and is never sorted for the caller — "a module that quietly
   * re-sorted it would move dates nobody edited" — so the row's index IS its
   * step number and there is no `sequence` field to read instead.
   *
   * Built once into a map rather than `rows.indexOf(r)` inside the cell, which
   * would be quadratic and would also break on the one thing `row_uid` does not
   * guarantee: a copied row while the operator is still typing.
   */
  const ordinal = new Map(rows.map((r, i) => [r.rowUid, i + 1]));

  const columns: Column<TnaMilestone>[] = [
    {
      header: "#",
      align: "center",
      className: "w-10",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">{ordinal.get(r.rowUid)}</span>
      ),
    },
    {
      header: "Activity",
      // The row's subject, so it carries the weight — everything else on the
      // line is context for it.
      cell: (r) => <span className="font-semibold">{r.activity}</span>,
    },
    {
      header: "Department",
      // Resolved THROUGH `activity_id` off `ta_activities.department`, never
      // copied onto the rung — see `TnaMilestone`. An em dash when the activity
      // names none, which is a real state on a hand-added rung.
      cell: (r) => <span className="text-muted-foreground">{r.departmentName ?? "—"}</span>,
    },
    {
      header: "Owner",
      // Null is not "unassigned by mistake": a rung with no owner belongs to
      // every eligible member of its department (0547).
      cell: (r) => <span className="text-muted-foreground">{r.assignedStaffName ?? "—"}</span>,
    },
    {
      header: "Days",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.daysRequired ?? "—"}</span>,
    },
    {
      header: "Target",
      align: "right",
      /**
       * `fmtDate` — DD/MM/YYYY, and never formatted at this call site
       * (AGENTS.md "Dates"). It already prints "—" for null, which is the
       * answer for a rung the ladder could not date: the backward walk stops at
       * a rung with no Days and every rung further from delivery goes null
       * rather than carrying a guessed date. A plan is read as a promise.
       */
      cell: (r) => <span className="tabular-nums">{fmtDate(r.targetDate)}</span>,
    },
    {
      header: "Actual",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">{fmtDate(r.actualDate)}</span>
      ),
    },
    {
      header: "Status",
      /**
       * The badge is handed a DERIVED state, so the column cannot show a stored
       * `pending` on a rung whose target went by last week. `tnaDaysLate`
       * answers null unless the rung really is late, so the "3d late" half
       * cannot print "0d late" on one due today.
       */
      cell: (r) => (
        <TnaStatusBadge state={tnaDisplayState(r, today)} daysLate={tnaDaysLate(r, today)} />
      ),
    },
  ];

  return (
    <DataTable<TnaMilestone> paginate={false}
      columns={columns}
      rows={rows as TnaMilestone[]}
      getKey={(r) => r.rowUid}
      bare={bare}
      /**
       * EMPTY-AND-EXPLAIN, never a bare "No records." An order with no ladder is
       * an ordinary state — it is every order on the day it is raised — and the
       * operator's next move is the Apply Template button in the header, so the
       * empty state says so. A silent empty table here reads exactly like a
       * ladder that failed to load.
       */
      empty="No ladder on this order yet — apply a template to lay out its milestones."
      /**
       * The late rungs carry a red edge as well as a red pill. Colour on the
       * chip alone puts the signal in the last column; the stripe is what makes
       * a slipped rung findable while scanning the Activity column on the left.
       */
      rowClassName={(r) =>
        tnaDisplayState(r, today) === "delayed"
          ? "shadow-[inset_2px_0_0_var(--danger)]"
          : undefined
      }
    />
  );
}
