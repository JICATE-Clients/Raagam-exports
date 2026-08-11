import { type ReactNode } from "react";
import type { Column } from "@/components/ui/data-table";
import { RowActionsCell } from "@/components/ui/row-actions";

/**
 * The trailing actions column — declared HERE, in a module with no `"use client"`
 * directive, because most of the screens that need it are SERVER components.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `rowActionsColumn` used to live in `row-actions.tsx`, which is `"use client"`.
 * Under React Server Components every non-component export of a client module is
 * a client REFERENCE: the server may render it as a component or pass it as a
 * prop, but it may not CALL it. Nine server pages built their `columns` array by
 * calling it at module scope, and the production build died on the first one:
 *
 *     Attempted to call rowActionsColumn() from the server but
 *     rowActionsColumn is on the client.
 *
 * NOTHING IN `tsc` CAN SEE THAT. The server/client boundary is not a type, so
 * the type-checker, the lint rules and every `check:*` script passed while
 * `next build` failed — which is why the fault reached CI rather than a
 * keystroke. `npm run build` is the only gate that catches this class.
 *
 * ── Why the fix is a MOVE and not a re-export ───────────────────────────────
 *
 * `row-actions.tsx` deliberately does NOT re-export this. A re-export would keep
 * the 96 client call sites working untouched — and would leave the exact trap
 * that caused the outage in place, because the next server page to write
 * `import { rowActionsColumn } from "@/components/ui/row-actions"` would compile
 * cleanly and fail in CI again. Importing it from the client module is now a
 * plain "has no exported member" error, caught by `tsc` at the call site, which
 * is the earliest and cheapest place to be told.
 *
 * ── How it stays legal ──────────────────────────────────────────────────────
 *
 * The cell RENDERS `<RowActionsCell>` — a client component — instead of calling
 * a client function. That is the one direction the boundary allows. The row goes
 * across as a prop, so it must stay serialisable (it is: a plain data row), and
 * `cell(row)` is evaluated on the server into a ReactNode passed as `children`,
 * which is exactly how server content is allowed to nest inside a client
 * component.
 */

/**
 * Fixed action-column width, sized for the delete-confirm strip so the table
 * does not reflow when the bin is clicked. Declare columns with
 * `rowActionsColumn()` rather than repeating this.
 */
export const ROW_ACTIONS_WIDTH = "w-40";

/**
 * Build the trailing actions column. Keeps header/align/width in one place so a
 * screen cannot get the column geometry subtly wrong, and publishes the row so
 * the eye works without any further wiring.
 */
export function rowActionsColumn<T>(cell: (row: T) => ReactNode): Column<T> {
  return {
    header: "",
    align: "right",
    className: ROW_ACTIONS_WIDTH,
    cell: (row) => <RowActionsCell row={row}>{cell(row)}</RowActionsCell>,
  };
}
