"use client";

import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import type { StatusTone } from "@/lib/ui/tone";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FileText, Send, type LucideIcon } from "lucide-react";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { FigureCell } from "@/components/orders/order-queue-table";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";

/**
 * THE SAMPLE MODULE'S CARD QUEUE (user 2026-10-12: "in grouping to accessories
 * plan … how we list the created order entry in card-like UI, same for this
 * too — SMP entry will list as card"; plan "Sample card queues").
 *
 * Orders ▸ Accessories Plan, Fabric Plan and Material BOM open on a grid of
 * cards drawn by `BomQueue` (components/orders/bom-queue.tsx) — but that queue
 * is typed to a garment order (`BomTaskRow`) and its facets are an order's. So
 * the sample screens draw the SAME card through the same primitive
 * (`MobileCardList`, `columns={6}`, `queue`) and the same two state shades,
 * and each screen passes only what is genuinely its own: the number, the
 * sub-line, the three figures and what a tap does. The search row, the
 * Pending / Updated / Draft box and the Filters panel stay the screen's, as
 * they were above its table.
 */

/** A card's state — the stripe and the pill both read it, so they agree. */
export type SampleCardState = "pending" | "updated" | "draft" | "neutral";

/* THE ORDERS QUEUE'S OWN SHADES (`QUEUE_THEME` in bom-queue.tsx): Pending a dark
   red, done a clean green. Copied as literals, not imported, because Tailwind
   scans source text and the two must stay static class strings. */
const PILL: Partial<Record<SampleCardState, string>> = {
  pending: "border border-red-200 bg-red-50 py-px text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300",
  updated: "border border-emerald-200 bg-emerald-50 py-px text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
};
const EDGE: Partial<Record<SampleCardState, string>> = {
  pending: "border-l-red-700 dark:border-l-red-500",
  updated: "border-l-emerald-500",
};
const TONE: Record<SampleCardState, StatusTone> = { pending: "danger", updated: "success", draft: "warning", neutral: "neutral" };

export function SampleQueuePill({ state, children }: { state: SampleCardState; children: ReactNode }) {
  return (
    <StatusPill tone={TONE[state]} className={PILL[state]}>
      {children}
    </StatusPill>
  );
}

export function SampleCards<R>({
  rows,
  getKey,
  title,
  subtitle,
  state,
  pillText,
  stats,
  onOpen,
  selected,
  footerNote,
  canDelete = false,
  canDeleteRow,
  onDelete,
  onReports,
  canReportsRow,
  onSend,
  canSendRow,
  sendLabel = "Send for approval",
  cardSendLabel = "Send",
  sendIcon = Send,
  isPending = false,
  empty,
  table,
  editDisabledReason,
  deleteDisabledReason,
  actions,
  rowEdit = true,
}: {
  rows: R[];
  getKey: (r: R) => string;
  title: (r: R) => ReactNode;
  subtitle?: (r: R) => ReactNode;
  state: (r: R) => SampleCardState;
  /** Omit where every card would say the same word the tab already says
   *  (Grouping ▸ Ungrouped's "To group", user 2026-10-15) — no pill is drawn. */
  pillText?: (r: R) => ReactNode;
  /** The three figures, in the Orders card's order: the main one, the count,
   *  then the date or the scope. */
  stats: (r: R) => CardStat[];
  /** A tap on the card — open the record, or (Grouping ▸ Ungrouped) tick it. */
  onOpen: (r: R) => void;
  /** A ticked card wears the theme colour down its edge. */
  selected?: (r: R) => boolean;
  footerNote?: (r: R) => ReactNode;
  canDelete?: boolean;
  canDeleteRow?: (r: R) => boolean;
  onDelete?: (r: R) => void;
  /** A report reachable without opening the row (see MobileCardList). */
  onReports?: (r: R) => void;
  canReportsRow?: (r: R) => boolean;
  /** Send this row for approval without opening it (see MobileCardList). */
  onSend?: (r: R) => void;
  canSendRow?: (r: R) => boolean;
  sendLabel?: string;
  /** The card's word for the same slot (short — a sixth of the pane); and its icon. */
  cardSendLabel?: string;
  sendIcon?: LucideIcon;
  isPending?: boolean;
  empty: ReactNode;
  /**
   * DRAW THESE ROWS AS A TABLE (user 2026-10-13, screenshot 3458: "the pending
   * stat card type ui, the updated tab should as table like how we followed
   * order module"). Orders' queues keep Pending / Draft as cards — work still
   * to do — and draw Updated as a compact table (`OrderQueueTable`). Same rows,
   * same click; the card's title, sub-line, figures and pill become columns.
   * The headers are the screen's, since a card never had to name them.
   */
  table?: { title: string; subtitle?: string };
  /**
   * WHY THIS ROW CANNOT BE EDITED / DELETED (AGENTS "Row actions": a LOCKED
   * record keeps its pencil and bin, GREYED, saying why — hiding is for missing
   * permission only). The table greys both; a card greys its Delete (its body
   * still opens the record, read-only where the screen locks it).
   */
  editDisabledReason?: (r: R) => string | null | undefined;
  deleteDisabledReason?: (r: R) => string | null | undefined;
  /** The row's own icons (an approval queue's decisions) — the card's footer,
   *  before the built-ins; the table's lead, after Reports / Send. */
  actions?: (r: R) => ReactNode;
  /** false: the table draws no pencil — for a pile that only ever OPENS
   *  read-only (a pencil that edits nothing promises what it cannot do). The
   *  number link still opens the row. */
  rowEdit?: boolean;
}) {
  /* EVERY LISTING PAGES ITSELF (AGENTS "Pagination"). The table mode's
     DataTable already does; the card grid did not, so a long Pending pile
     printed every card. Called above the table branch — hooks never sit below
     an early return. */
  const pg = usePagination(rows);
  if (table) {
    const figures = rows[0] ? stats(rows[0]) : [];
    const cols: Column<R>[] = [
      {
        header: table.title,
        className: HUG,
        /* A real <button>, as every Orders queue table draws its RE No. */
        cell: (r) => (
          <button
            type="button"
            onClick={() => onOpen(r)}
            className="rounded-sm text-left font-mono text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {title(r)}
          </button>
        ),
      },
      ...(subtitle && table.subtitle ? [{ header: table.subtitle, cell: (r: R) => <span className="text-xs">{subtitle(r)}</span> }] : []),
      ...figures.map((f, i) => ({
        header: f.label,
        className: HUG,
        cell: (r: R) => <FigureCell value={stats(r)[i]?.value ?? null} />,
      })),
      ...(pillText
        ? [{ header: "Status", className: HUG, cell: (r: R) => <SampleQueuePill state={state(r)}>{pillText(r)}</SampleQueuePill> }]
        : []),
      rowActionsColumn((r) => (
        <RowActions
          view={false}
          /* The card's Reports, in the eye's slot (Row actions rule). */
          lead={
            onReports || onSend || actions ? (
              <>
                {onReports ? (
                  <RowIconAction
                    label="Reports"
                    icon={FileText}
                    className="text-primary"
                    onClick={canReportsRow?.(r) === false ? undefined : () => onReports(r)}
                    disabledReason={canReportsRow?.(r) === false ? "Nothing to report on yet" : null}
                  />
                ) : null}
                {onSend && canSendRow?.(r) !== false ? (
                  <RowIconAction label={sendLabel} icon={sendIcon} className="text-primary" onClick={() => onSend(r)} />
                ) : null}
                {actions?.(r)}
              </>
            ) : undefined
          }
          onEdit={rowEdit ? () => onOpen(r) : undefined}
          editDisabledReason={editDisabledReason?.(r) ?? null}
          onDelete={onDelete ? () => onDelete(r) : undefined}
          canDelete={canDelete && (canDeleteRow ? canDeleteRow(r) : true)}
          deleteDisabledReason={deleteDisabledReason?.(r) ?? null}
          isPending={isPending}
        />
      )),
    ];
    return (
      <div className="w-fit max-w-full">
        <DataTable columns={hugCreated(withCreatedColumns(cols, rows))} rows={rows} compact getKey={getKey} empty={empty} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
    <MobileCardList<R>
      columns={6}
      queue
      rows={pg.paged}
      getKey={getKey}
      title={title}
      subtitle={subtitle}
      pill={pillText ? (r) => <SampleQueuePill state={state(r)}>{pillText(r)}</SampleQueuePill> : undefined}
      stats={stats}
      tone={(r) => TONE[state(r)]}
      accent={(r) => (selected?.(r) ? "border-l-primary" : EDGE[state(r)])}
      footerNote={footerNote}
      onEdit={onOpen}
      canDelete={canDelete}
      canDeleteRow={canDeleteRow}
      deleteDisabledReason={deleteDisabledReason}
      extraActions={actions}
      onDelete={onDelete}
      onReports={onReports}
      canReportsRow={canReportsRow}
      onSend={onSend}
      canSendRow={canSendRow}
      /* The card names its buttons in words, and a sixth of the pane has room for one. */
      sendLabel={cardSendLabel}
      sendIcon={sendIcon}
      isPending={isPending}
      empty={empty}
    />
      {/* The bar draws only past one page, as under every DataTable. */}
      {pg.pageCount > 1 && (
        <PaginationBar
          page={pg.page}
          pageCount={pg.pageCount}
          total={pg.total}
          pageSize={pg.pageSize}
          onPageChange={pg.setPage}
          onPageSizeChange={pg.setPageSize}
        />
      )}
    </div>
  );
}
