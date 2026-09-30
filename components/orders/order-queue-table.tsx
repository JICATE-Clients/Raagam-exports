"use client";

import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FileText } from "lucide-react";
import { RowActions, RowIconAction, type RowMenuItem } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";

/**
 * THE "UPDATED" VIEW OF A WORK QUEUE, AS A TABLE (user, 2026-09-24,
 * screenshot 3045).
 *
 * Material BOM, Fabric BOM and Budgeting open on a Pending / Updated / Draft
 * box. Pending and Draft are WORK and stay cards (bom-queue.tsx). Updated is
 * done, and is drawn in the Order Entry listing's LAYOUT — a compact table,
 * RE No that opens the record, Created Date / Created User, the row actions.
 *
 * THE LAYOUT IS SHARED, THE DETAILS ARE NOT (user, same day: "with those tab
 * customized details, not the order entry child details"). The first cut
 * copied Order Entry's columns — thumbnail, order date, order quantity — onto
 * all three, so each module's Updated list read as a second Order Entry. Each
 * module passes its OWN columns instead: the facts its card already shows
 * (Production · Styles on Material BOM, Production · Lines on Fabric BOM,
 * Order Qty · Cut Qty and the budget's state on Budgeting). RE No, Customer
 * and PO No are shared because they are every one of those cards' heading.
 */
export function OrderQueueTable<T extends { id: string; created_at?: string | null; created_by?: string | null }>({
  rows,
  heading,
  columns,
  onOpen,
  canDelete = false,
  canDeleteRow,
  lockReason,
  reports,
  onDelete,
  menu,
  isPending = false,
  empty,
}: {
  rows: T[];
  /** The card's heading — its title (RE No) and subtitle (customer · PO). */
  heading: (row: T) => { reNo: string | null; customer: string | null; poNo: string | null };
  /** This module's own details, placed after PO No and before the Created pair. */
  columns: Column<T>[];
  /** The RE No and the pencil both open the record — the card's one tap. */
  onOpen: (row: T) => void;
  canDelete?: boolean;
  canDeleteRow?: (row: T) => boolean;
  /**
   * WHY THIS ROW IS LOCKED, or null when it is not — the lock's own sentence
   * (`orderLocks`): approved ("… Raise an Order Revision to change it"),
   * waiting for the MD (0652), or a revision that does not cover this module.
   * The pencil and bin stay, GREYED, with this as their tooltip (client
   * 2026-09-29 — reversing 2026-09-24's "eye instead of pencil, no bin", which
   * could not be told apart from a missing permission), so the row, the
   * editor's banner and the database's refusal say one thing. The RE No still
   * opens the record, read-only (`MasterFullScreen locked`).
   */
  lockReason?: (row: T) => string | null | undefined;
  onDelete?: (row: T) => void;
  /**
   * The row's Reports, drawn FIRST in the eye's slot (no ⋮ — see
   * `RowIconAction`). Return the handler, or null where the row has no
   * document to report on yet (the icon greys and says so).
   */
  reports?: (row: T) => (() => void) | null;
  menu?: (row: T) => RowMenuItem[];
  isPending?: boolean;
  empty: ReactNode;
}) {
  const all: Column<T>[] = [
    {
      header: "RE No",
      /* A real <button>, as on Order Entry: opening the record is what the row
         is for, and a button is a Tab stop on a list page with Enter working. */
      cell: (r) => {
        const no = heading(r).reNo;
        return (
          <button
            type="button"
            onClick={() => onOpen(r)}
            className="rounded-sm text-left text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${no ?? "order"}`}
          >
            <span className="font-mono text-xs font-semibold">{no ?? "—"}</span>
          </button>
        );
      },
    },
    {
      header: "Customer",
      cell: (r) => <span className="text-xs">{heading(r).customer ?? "—"}</span>,
    },
    {
      header: "PO No",
      cell: (r) => <span className="font-mono text-xs">{heading(r).poNo ?? "—"}</span>,
    },
    ...columns,
    rowActionsColumn((r) => {
      const why = lockReason?.(r) ?? null;
      return (
        <RowActions
          label={heading(r).reNo}
          /* NO EYE: these queues have no read-only view of their own, and the
             automatic one would only repeat the row's columns back. The RE No
             opens the record (read-only when locked); Reports takes the eye's
             slot where the module has any. */
          view={false}
          lead={
            reports ? (
              <RowIconAction
                label="Reports"
                name={heading(r).reNo}
                icon={FileText}
                className="text-primary"
                onClick={reports(r) ?? undefined}
                disabledReason={reports(r) ? null : "No document yet — nothing to report on"}
              />
            ) : undefined
          }
          onEdit={() => onOpen(r)}
          editDisabledReason={why}
          onDelete={onDelete ? () => onDelete(r) : undefined}
          canDelete={canDelete && (canDeleteRow ? canDeleteRow(r) : true)}
          deleteDisabledReason={why}
          menu={menu?.(r)}
          isPending={isPending}
        />
      );
    }),
  ];

  return (
    <DataTable
      columns={withCreatedColumns(all, rows)}
      rows={rows}
      compact
      getKey={(r) => r.id}
      empty={empty}
    />
  );
}

/** A figure cell — right-aligned tabular digits, Order Entry's Quantity shape.
 *  A refusal keeps its sentence in the tooltip rather than reading as a dash. */
export function FigureCell({ value, refusal }: { value: ReactNode | null; refusal?: string | null }) {
  return (
    <span className="block text-right font-mono tabular-nums text-xs" title={value == null ? (refusal ?? undefined) : undefined}>
      {value ?? "—"}
    </span>
  );
}
