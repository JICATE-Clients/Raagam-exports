"use client";

import { type ReactNode } from "react";
import { Eye } from "lucide-react";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * The card list every master screen used to hand-roll — extracted, plus the
 * delete affordance mobile users never had (delete lived only in the desktop
 * table's row actions). The card body is a tap-to-edit button; the view and
 * delete controls render in a footer row as SIBLINGS of that button (never
 * nested inside it), so the two-step DeleteConfirmButton works without invalid
 * button-in-button markup.
 *
 * THE NAME IS HISTORICAL. This began as the `md:hidden` half of a master screen
 * and is no longer mobile-only: Orders ▸ Material BOM renders it as its ONLY
 * list, at every width, as a 3-across grid (operator request 2026-08-17). It is
 * still called `MobileCardList` because renaming touches 7 call sites for no
 * behaviour — worth doing, separately.
 *
 * `md:hidden` HAS ALWAYS LIVED AT THE CALL SITE, never in here, and that is the
 * whole reason the above cost nothing: a caller that wants cards on desktop
 * simply omits the wrapper, and no existing screen changes.
 */
export function MobileCardList<Row>({
  rows,
  getKey,
  title,
  subtitle,
  pill,
  meta,
  onEdit,
  onView,
  canDelete = false,
  canDeleteRow,
  onDelete,
  isPending = false,
  empty = "No records yet.",
  columns = 1,
}: {
  rows: Row[];
  getKey: (r: Row) => string;
  /** Bold first line (usually name). */
  title: (r: Row) => ReactNode;
  /** Muted mono second line (usually code). */
  subtitle?: (r: Row) => ReactNode;
  /** Top-right StatusPill slot. */
  pill?: (r: Row) => ReactNode;
  /** Optional extra muted line under the subtitle. */
  meta?: (r: Row) => ReactNode;
  /** Tap-to-edit; omit to render cards non-tappable. */
  onEdit?: (r: Row) => void;
  /** Read-only view (eye icon in the footer row). Omit to hide it. Worth wiring
   *  wherever the desktop table has a view action — on a phone the tap target IS
   *  edit, so without this there is no way to just look at a record. */
  onView?: (r: Row) => void;
  canDelete?: boolean;
  /**
   * PER-ROW delete, on top of the permission-level `canDelete`.
   *
   * Some rows are not deletable for a reason that is about the ROW, not the
   * user: Material BOM's queue lists every confirmed order, and only the ones
   * that already have a BOM have anything to delete. Without this the button
   * renders on all of them and does nothing when pressed — a dead control is
   * worse than an absent one.
   *
   * Only the BUTTON is gated. The footer strip still renders across the list, so
   * cards in a grid row keep matching heights.
   */
  canDeleteRow?: (r: Row) => boolean;
  onDelete?: (r: Row) => void;
  isPending?: boolean;
  empty?: ReactNode;
  /**
   * Cards per row at the widest breakpoint. **Defaults to 1**, which is the
   * single-column stack every existing caller renders inside its own
   * `md:hidden` — so adding this prop cannot change any of them.
   *
   * 2 and 3 both step down to 2-up at `sm` and 1-up below it, because a card is
   * unreadable at a third of a phone.
   */
  columns?: 1 | 2 | 3;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }

  const showDelete = canDelete && !!onDelete;
  const showFooter = showDelete || !!onView;
  const grid = columns > 1;

  return (
    <div
      className={
        grid
          ? cn("grid gap-3 sm:grid-cols-2", columns === 3 && "xl:grid-cols-3")
          : "space-y-2.5"
      }
    >
      {rows.map((r) => (
        <div
          key={getKey(r)}
          className={cn(
            "rounded-xl border border-border bg-surface",
            // EQUAL HEIGHTS, GRID ONLY. Cards along a row carry different amounts
            // of meta, so without this the shortest card's footer floats up and
            // the delete buttons do not line up. Guarded on `grid` so the
            // single-column stack every other caller renders is unchanged.
            grid && "flex h-full flex-col",
          )}
        >
          <button
            type="button"
            onClick={onEdit ? () => onEdit(r) : undefined}
            disabled={!onEdit}
            className={cn(
              "block w-full p-4 text-left enabled:active:bg-surface-muted disabled:cursor-default",
              grid && "flex-1",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Truncated className="text-[15px] font-semibold text-foreground">{title(r)}</Truncated>
                {subtitle && (
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">{subtitle(r)}</div>
                )}
                {meta && <div className="mt-0.5 text-xs text-muted-foreground">{meta(r)}</div>}
              </div>
              {pill && pill(r)}
            </div>
          </button>
          {showFooter && (
            <div className="flex items-center justify-end gap-1 border-t border-border px-3 py-1.5">
              {onView && (
                <Button variant="ghost" size="sm" aria-label="View" title="View" onClick={() => onView(r)}>
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              {showDelete && (canDeleteRow?.(r) ?? true) && (
                <DeleteConfirmButton isPending={isPending} onConfirm={() => onDelete!(r)} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
