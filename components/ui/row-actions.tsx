"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
// Layering note: `components/ui` reaching into `components/masters` for the view
// sheet is backwards, and deliberate — the alternative was a second read-only
// sheet with the same job. There is no cycle: record-view-sheet does not import
// this file.
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { pairsFromRow, titleFromRow } from "@/lib/record-pairs";

/**
 * The View / Edit / Delete cluster at the end of a listing-table row — one
 * component for the whole app.
 *
 * It replaces 131 hand-rolled `header: ""` cells that had drifted into six
 * incompatible dialects: eye+Edit+two-step-Delete (11 screens), Edit+two-step
 * (~35), Edit + one-click Delete with no confirm (9), Edit+Deactivate (3),
 * Edit+`Del` (~15), and Edit+Delete behind `window.confirm` (~13). Only 12 of
 * ~62 master screens offered a View at all, so "what is in this record?" meant
 * opening the editor and remembering not to touch anything.
 *
 * ICONS, NOT TEXT LINKS, and the reason is internal consistency rather than
 * taste: `data-picker.tsx:540-571` — the one picker for the whole app — already
 * renders row CRUD as `Pencil` ("Modify (F2)") and `Trash2` ("Delete
 * (Ctrl+Del)"). Matching it means a picker row and a table row read the same.
 * It also gives every table ONE action-column width instead of the per-screen
 * jitter that came from mixing icons and text, and these are actions an
 * operator repeats all day — learned in a session, then scanned, not read.
 *
 * Icon sizing is deliberately absent here: `button.tsx:50` pins
 * `[&_svg]:size-4` on every button, and a caller that sets its own svg size
 * fights it (`simple-master-screen.tsx:654` did, at `h-3.5 w-3.5`).
 *
 * DELETE OWNS THE WHOLE CLUSTER WHILE CONFIRMING. Clicking the bin swaps the
 * three icons for `Delete? [Cancel] [Confirm]` rather than expanding beside
 * them — which is what keeps `ROW_ACTIONS_WIDTH` honest, since the confirm
 * strip is the widest state the cell ever has. The confirm step is not a
 * courtesy: `lib/masters/delete-guard.ts` decides delete-vs-deactivate
 * server-side, so the label cannot promise which one the operator is about to
 * get — `deletedToast` says which one happened.
 *
 * `DeleteConfirmButton` is NOT superseded by this. It is the same two-step
 * wearing a text label, and it stays the mobile control (`MobileCardList`,
 * `SimpleMasterScreen`'s card footer) where an icon is not a touch target.
 *
 * THE EYE COSTS A SCREEN NOTHING. `rowActionsColumn` publishes the row, so the
 * View is built from the record itself (lib/record-pairs.ts) unless the screen
 * takes over with `onView` or opts out with `view={false}`. The first pass at
 * this made the eye opt-IN and 102 of 111 tables promptly shipped without one —
 * the same gap the component was built to close. Defaults decide adoption.
 *
 * Mobile does not use this cell. Tables are `hidden md:block` and phones get
 * `MobileCardList`, whose footer carries real text labels — 32px icon buttons
 * are not a touch target, and this ships as an installed PWA.
 */

export type RowMenuItem = DropdownItem;

/**
 * The row the actions cell belongs to, so `RowActions` can offer a View without
 * every screen threading the record back into it by hand.
 *
 * This exists because the obvious home for the auto-view — `DataTable`, the only
 * thing that knows the columns — cannot have it: 42 SERVER components render
 * DataTable and pass `cell` functions in `columns`, and functions cannot cross
 * the server→client boundary, so DataTable must stay free of client state.
 * `rowActionsColumn` is already on every call site and already has the row, so
 * the row is what the view gets built from (see lib/record-pairs.ts).
 */
const RowRecordContext = createContext<unknown>(undefined);

/**
 * Publish the row to `RowActions` beneath it.
 *
 * A COMPONENT, not a function that returns a column — and that distinction is
 * the whole point. `rowActionsColumn` lived here and was CALLED by nine server
 * pages, which React Server Components forbids for any non-component export of
 * a `"use client"` module; the production build failed on it. The column builder
 * now lives in `row-actions-column.tsx` (no directive) and RENDERS this, which
 * is the one direction across the boundary that is allowed.
 *
 * Deliberately NOT re-exported from here — see that file for why leaving the old
 * import path working would have preserved the trap.
 */
export function RowActionsCell<T>({
  row,
  children,
}: {
  row: T;
  children: ReactNode;
}) {
  return <RowRecordContext.Provider value={row}>{children}</RowRecordContext.Provider>;
}

export function RowActions({
  label,
  onView,
  onEdit,
  editHref,
  onDelete,
  canEdit = true,
  canDelete = true,
  editDisabled = false,
  isPending = false,
  deleteLabel = "Delete",
  menu = [],
  row,
  view,
}: {
  /**
   * The record's name, folded into every `aria-label` ("View 20'S COTTON
   * COMBED"). Without it a screen reader hears "View" forty times with no way
   * to tell the rows apart.
   *
   * Accepts null so a nullable column (`r.name`) can be passed straight in
   * rather than being `?? ""`-ed at a hundred call sites.
   */
  label?: string | null;
  /**
   * Take over the eye — for a screen with a purpose-built view sheet
   * (`MaterialViewSheet`, the resolved-FK view `MasterListShell` builds). Always
   * wins over the automatic one.
   */
  onView?: () => void;
  /**
   * Edit as a LINK rather than a handler — for a list rendered by a SERVER
   * component, which cannot hand a client component an `onEdit` closure
   * (functions do not cross the RSC boundary; a string does).
   *
   * This is what lets the Orders module's `page.tsx` listings carry the same
   * View + Edit cluster as Master Data without each one being rewritten as a
   * client component first. Ignored when `onEdit` is given — a screen that can
   * run a handler should, since that is the richer control.
   */
  editHref?: string;
  /**
   * The record, when `rowActionsColumn` is not what rendered this cell (a
   * hand-rolled `<td>`, a card footer). Normally inferred from context.
   */
  row?: unknown;
  /**
   * `false` suppresses the eye — for a grid whose columns already ARE the whole
   * record, where a view sheet would repeat the row back. An array supplies
   * hand-written sections instead of the row-derived ones.
   */
  view?: false | ViewSection[];
  /** Omit — or pass `canEdit={false}` — to hide the pencil. */
  onEdit?: () => void;
  /** Omit — or pass `canDelete={false}` — to hide the bin. */
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Greys out Edit without hiding it — e.g. another row is mid-inline-edit. */
  editDisabled?: boolean;
  /** Disables Confirm while the delete action is in flight. */
  isPending?: boolean;
  /** Override the confirm wording where "Delete" is the wrong verb. */
  deleteLabel?: string;
  /** Extra actions behind a `⋮` — Duplicate, Export row. Never Delete. */
  menu?: RowMenuItem[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState(false);
  const contextRow = useContext(RowRecordContext);

  const showEdit = !!onEdit && canEdit;
  /** The link form, only when there is no handler to prefer. */
  const showEditLink = !onEdit && !!editHref && canEdit && !editDisabled;
  const showDelete = !!onDelete && canDelete;
  const suffix = label ? ` ${label}` : "";

  // THE EYE IS ON BY DEFAULT. A screen gets a View by doing nothing, because the
  // opposite default is what left ~100 listing tables with no way to read a
  // record short of opening its editor. Opt out with `view={false}`.
  const record = row ?? contextRow;
  const autoView = !onView && view !== false && record != null;
  const handleView = onView ?? (autoView ? () => setViewing(true) : undefined);

  // Rendered alongside BOTH branches below — a view opened from this row must
  // survive the cluster flipping into its delete-confirm state.
  const sheet =
    autoView && viewing ? (
      <RecordViewSheet
        open
        onClose={() => setViewing(false)}
        title={label || titleFromRow(record)}
        sections={
          Array.isArray(view)
            ? view
            : [{ label: "Details", pairs: pairsFromRow(record) }]
        }
      />
    ) : null;

  // Deliberately does not collapse after Confirm: on success the row leaves the
  // list on refresh anyway, and on failure the strip stays put so the operator
  // can retry without hunting for the bin again (inherited from
  // DeleteConfirmButton, whose behaviour this preserves).
  if (confirming) {
    return (
      <>
        <div className="flex items-center justify-end gap-1">
          <span className="text-xs text-muted-foreground">{deleteLabel}?</span>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={isPending} onClick={onDelete}>
            {isPending ? "…" : "Confirm"}
          </Button>
        </div>
        {sheet}
      </>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {handleView && (
        <Tooltip label="View">
          <Button variant="ghost" size="icon" aria-label={`View${suffix}`} onClick={handleView}>
            <Eye />
          </Button>
        </Tooltip>
      )}
      {showEdit && (
        <Tooltip label="Edit">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit${suffix}`}
            disabled={editDisabled}
            onClick={onEdit}
          >
            <Pencil />
          </Button>
        </Tooltip>
      )}
      {showEditLink && (
        <Tooltip label="Edit">
          {/* A LINK wearing the button's classes, not a Button wrapping a Link:
              nesting the two is invalid HTML and puts two stops in the Tab path
              for one control. `buttonClasses` is the shared string so this
              cannot drift from the real buttons beside it. */}
          <Link
            href={editHref!}
            aria-label={`Edit${suffix}`}
            className={buttonClasses({ variant: "ghost", size: "icon" })}
          >
            <Pencil />
          </Link>
        </Tooltip>
      )}
      {showDelete && (
        <Tooltip label={deleteLabel}>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-danger"
            aria-label={`${deleteLabel}${suffix}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </Button>
        </Tooltip>
      )}
      {menu.length > 0 && <DropdownMenu items={menu} label={`More actions${suffix}`} />}
      {sheet}
    </div>
  );
}
