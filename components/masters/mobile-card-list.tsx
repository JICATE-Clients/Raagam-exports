"use client";

import { type ReactNode } from "react";
import { Eye } from "lucide-react";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { Button } from "@/components/ui/button";

/**
 * The mobile (`md:hidden`) card list every master screen used to hand-roll —
 * extracted, plus the delete affordance mobile users never had (delete lived
 * only in the desktop table's row actions). The card body is a tap-to-edit
 * button; the view and delete controls render in a footer row as SIBLINGS of
 * that button (never nested inside it), so the two-step DeleteConfirmButton
 * works without invalid button-in-button markup.
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
  onDelete,
  isPending = false,
  empty = "No records yet.",
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
  onDelete?: (r: Row) => void;
  isPending?: boolean;
  empty?: ReactNode;
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

  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={getKey(r)} className="rounded-xl border border-border bg-surface">
          <button
            type="button"
            onClick={onEdit ? () => onEdit(r) : undefined}
            disabled={!onEdit}
            className="block w-full p-4 text-left enabled:active:bg-surface-muted disabled:cursor-default"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">{title(r)}</div>
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
              {showDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => onDelete!(r)} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
