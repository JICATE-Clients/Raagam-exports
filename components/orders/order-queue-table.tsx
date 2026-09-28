"use client";

import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, type RowMenuItem } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";

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
  lockedRow,
  onDelete,
  menu,
  isPending = false,
  empty,
  fit = false,
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
   * An APPROVED order (or one whose open Revision does not cover this module):
   * the row offers the EYE instead of the pencil and no bin (client
   * 2026-09-24). The eye opens the same record — the editor is already
   * read-only for it (`MasterFullScreen locked`) — and the server refuses a
   * delete regardless; this is the half that stops offering one.
   */
  lockedRow?: (row: T) => boolean;
  onDelete?: (row: T) => void;
  menu?: (row: T) => RowMenuItem[];
  isPending?: boolean;
  empty: ReactNode;
  /**
   * THE TABLE IS AS WIDE AS ITS COLUMNS, not the pane (erp-table-fit skill,
   * client 2026-09-28, Material BOM ▸ Updated). Every column but Customer is
   * hugged — RE No, PO No and each module's own columns are codes, figures and
   * dates — and the frame shrinks to `w-fit`. Customer, the one name, stays
   * unsized so a long party name wraps. OPT-IN: three queues share this table
   * and only Material BOM asked.
   */
  fit?: boolean;
}) {
  const all: Column<T>[] = [
    {
      header: "RE No",
      /* A real <button>, as on Order Entry: opening the record is what the row
         is for, and a button is a Tab stop on a list page with Enter working.
         THE SAME BLUE AND WEIGHT AS EVERY OTHER RE NO LINK (client 2026-09-28,
         screenshot 142050) — `font-medium text-primary`, the shape All Orders,
         CAD, Fabric Plan and Advised Items already draw. It was `font-semibold`,
         and a same-day swap to `text-info` made it a darker blue than theirs;
         both are undone so the RE No reads identically everywhere. */
      cell: (r) => {
        const no = heading(r).reNo;
        return (
          <button
            type="button"
            onClick={() => onOpen(r)}
            className="rounded-sm text-left text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${no ?? "order"}`}
          >
            <span className="font-mono text-xs font-medium">{no ?? "—"}</span>
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
      const locked = lockedRow?.(r) ?? false;
      return (
        <RowActions
          label={heading(r).reNo}
          /* NO AUTOMATIC EYE: these queues have no read-only view of their own,
             and the automatic one would only repeat the row's columns back. The
             pencil opens the record, as the RE No does — and on a LOCKED row the
             eye takes its place, opening the same (read-only) record. */
          view={false}
          onView={locked ? () => onOpen(r) : undefined}
          onEdit={() => onOpen(r)}
          canEdit={!locked}
          onDelete={onDelete ? () => onDelete(r) : undefined}
          canDelete={canDelete && !locked && (canDeleteRow ? canDeleteRow(r) : true)}
          menu={menu?.(r)}
          isPending={isPending}
        />
      );
    }),
  ];

  const table = (
    <DataTable
      columns={
        fit
          ? hugCreated(
              withCreatedColumns(
                all.map((c) =>
                  c.header === "Customer" || c.header === ""
                    ? c // the name, and the row actions (fixed width already)
                    : { ...c, className: [c.className, HUG].filter(Boolean).join(" ") },
                ),
                rows,
              ),
            )
          : withCreatedColumns(all, rows)
      }
      rows={rows}
      compact
      getKey={(r) => r.id}
      empty={empty}
    />
  );
  return fit ? <div className="w-fit max-w-full">{table}</div> : table;
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
