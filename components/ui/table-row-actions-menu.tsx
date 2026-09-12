"use client";

import { useState } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useRowRecord } from "@/components/ui/row-actions";
// Same layering compromise `row-actions.tsx` already makes and documents:
// `components/ui` reaching into `components/masters` for the view sheet is
// backwards, and deliberate — the alternative is a second read-only sheet with
// the same job. There is no cycle; record-view-sheet imports neither file.
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { pairsFromRow, titleFromRow } from "@/lib/record-pairs";

/**
 * THE ROW ACTIONS CELL AS A SINGLE ⋮ MENU — View / Edit / Delete behind one
 * button.
 *
 * ## HOW THIS RELATES TO `RowActions`, WHICH IS NOT GOING AWAY
 *
 * `RowActions` renders the same three actions as three inline icons and is on
 * ~131 listings. This is the collapsed form of that cell, and it is a SECOND
 * renderer rather than a rewrite of the first for one reason: the thing that
 * file's own header warns about is a contract-level behaviour being copied per
 * screen. So this is not something a screen hand-rolls either — like
 * `RowActions`, the only wiring path is `MasterListShell`, which builds the
 * cell, gates it on `perms`, derives the aria-labels and feeds the same handlers
 * to the mobile card. A screen opts in with `actions.variant="menu"`; it never
 * renders this itself.
 *
 * ## THE STATUS IS NOT IN HERE, AND IT WAS, FOR ONE DAY
 *
 * The first cut of this menu carried an Active / Inactive radio pair, and the
 * listing dropped its Status column to pay for it. The client reversed that the
 * same day (2026-09-11): the status goes back in its own column as a switch
 * (`StatusToggle`), and this menu keeps only the three row commands.
 *
 * The reversal is worth recording rather than quietly applying, because the
 * argument for the menu version was not silly — it put the state and the control
 * for it in one place. What it cost is the thing a listing is FOR: a column can
 * be read down forty rows at a glance, and a state buried one click deep in a
 * per-row menu cannot be read at all without opening forty menus. Do not "tidy"
 * the status back in here.
 *
 * `DropdownItem.checked` and `dot` stay on the primitive. Nothing uses them
 * today; they are a menu's honest way to report a state, and deleting them would
 * only mean rebuilding them for the next menu that has one.
 *
 * ## DELETE CONFIRMS IN A DIALOG BECAUSE THE CELL IS GONE
 *
 * `RowActions` confirms by swapping its three icons for `Delete? [Cancel]
 * [Confirm]` in the cell itself. That needs a cell with something in it; here
 * the cell is one button and the menu has already closed by the time the handler
 * runs. `ConfirmDialog` is the replacement, and its own file records why the
 * wording must not promise deletion: `delete-guard.ts` decides
 * delete-vs-deactivate server-side, so `deletedToast` is what says which one
 * happened.
 *
 * ## THE EYE COSTS A SCREEN NOTHING, exactly as it costs `RowActions` nothing
 *
 * `rowActionsColumn` publishes the row, so a View is built from the record
 * itself (`lib/record-pairs.ts`) unless the screen takes over with `onView` or
 * opts out with `view={false}`.
 *
 * This was opt-in for a day and it was wrong for a day. `MasterListShell` always
 * derives an `onView`, so the gap was invisible while the shell was the only
 * caller — and then the first HAND-ROLLED listing to adopt this (Destination,
 * which builds its own `DataTable`) would have silently lost the eye it already
 * had. That is `row-actions.tsx`'s own "defaults decide adoption" lesson
 * arriving one component later, and the fix is the same default it chose.
 */
export function TableRowActionsMenu({
  label,
  onView,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
  isPending = false,
  deleteLabel = "Delete",
  menu = [],
  row,
  view,
}: {
  /**
   * The record's name, folded into the trigger's `aria-label` and into the
   * delete dialog's title. Without it a screen reader hears "Actions" forty
   * times with no way to tell the rows apart.
   */
  label?: string | null;
  /**
   * Take over the eye — for a screen with a purpose-built view sheet. Always
   * wins over the automatic one.
   */
  onView?: () => void;
  /**
   * The record, when `rowActionsColumn` is not what rendered this cell (a
   * hand-rolled `<td>`, a card footer). Normally inferred from context.
   */
  row?: unknown;
  /**
   * `false` suppresses the eye — for a grid whose columns already ARE the whole
   * record. An array supplies hand-written sections instead of row-derived ones.
   */
  view?: false | ViewSection[];
  /** Omit, or pass `canEdit={false}`, to drop the Edit item. */
  onEdit?: () => void;
  /** Omit, or pass `canDelete={false}`, to drop the Delete item. */
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Disables Confirm while the action is in flight. */
  isPending?: boolean;
  /** Override the confirm wording where "Delete" is the wrong verb. */
  deleteLabel?: string;
  /** Extra actions, placed between Edit and Delete. */
  menu?: DropdownItem[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState(false);
  const contextRow = useRowRecord();

  const suffix = label ? ` ${label}` : "";

  // THE EYE IS ON BY DEFAULT — see the note above. Opt out with `view={false}`.
  const record = row ?? contextRow;
  const autoView = !onView && view !== false && record != null;
  const handleView = onView ?? (autoView ? () => setViewing(true) : undefined);

  const items: DropdownItem[] = [];

  if (handleView) items.push({ label: "View", icon: Eye, onClick: handleView });
  if (onEdit && canEdit) items.push({ label: "Edit", icon: Pencil, onClick: onEdit });

  // A caller's own items keep any separator they declared; otherwise the first
  // of them opens a group of its own.
  menu.forEach((m, i) =>
    items.push({ ...m, separatorBefore: m.separatorBefore ?? (i === 0 && items.length > 0) }),
  );

  if (onDelete && canDelete) {
    items.push({
      label: deleteLabel,
      icon: Trash2,
      danger: true,
      separatorBefore: items.length > 0,
      onClick: () => setConfirming(true),
    });
  }

  if (items.length === 0) return null;

  return (
    <>
      <div className="flex items-center justify-end">
        <DropdownMenu items={items} label={`Actions${suffix}`} align="right" />
      </div>
      {autoView && viewing && (
        <RecordViewSheet
          open
          onClose={() => setViewing(false)}
          title={label || titleFromRow(record)}
          sections={
            Array.isArray(view) ? view : [{ label: "Details", pairs: pairsFromRow(record) }]
          }
        />
      )}
      <ConfirmDialog
        open={confirming}
        title={`${deleteLabel}${suffix || " this record"}?`}
        confirmLabel={deleteLabel}
        isPending={isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onDelete?.();
        }}
      />
    </>
  );
}
