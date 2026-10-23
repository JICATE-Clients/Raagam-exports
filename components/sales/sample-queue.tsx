"use client";

import type { ViewMode } from "@/components/ui/view-toggle";
import { Fragment, type ReactNode } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import type { StatusTone } from "@/lib/ui/tone";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FileText, Send, type LucideIcon } from "lucide-react";
import { StatusMark, type StatusMarkKind } from "@/components/ui/status-mark";
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

/** A card's state — the pill and the table's Status column both read it. */
export type SampleCardState = "pending" | "updated" | "draft" | "neutral";

/* THE ORDERS QUEUE'S OWN SHADES (`QUEUE_THEME` in bom-queue.tsx): Pending a dark
   red, done a clean green. Copied as literals, not imported, because Tailwind
   scans source text and the two must stay static class strings. */
const PILL: Partial<Record<SampleCardState, string>> = {
  pending: "border border-red-200 bg-red-50 py-px text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300",
  updated: "border border-emerald-200 bg-emerald-50 py-px text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
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
  mark,
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
  iconActions = false,
  renderCard,
  view,
}: {
  rows: R[];
  getKey: (r: R) => string;
  title: (r: R) => ReactNode;
  subtitle?: (r: R) => ReactNode;
  state: (r: R) => SampleCardState;
  /** Omit where every card would say the same word the tab already says
   *  (Grouping ▸ Ungrouped's "To group", user 2026-10-15) — no pill is drawn. */
  pillText?: (r: R) => ReactNode;
  /** The card's icon (components/ui/status-mark.tsx) when the word alone cannot
   *  say it — a composite label such as "Approved · Rev 2". */
  mark?: (r: R) => StatusMarkKind | undefined;
  /** The three figures, in the Orders card's order: the main one, the count,
   *  then the date or the scope. */
  stats: (r: R) => CardStat[];
  /** A tap on the card — open the record, or (Grouping ▸ Ungrouped) tick it. */
  onOpen: (r: R) => void;
  /**
   * A SCREEN'S OWN CARD (Sample Costing's buyer-glow card, user 2026-10-21).
   * Card view only: the grid, the pager and the table view stay this
   * component's, and the card props above still name the table's columns.
   */
  renderCard?: (r: R) => ReactNode;
  /** A ticked card is ringed in the theme colour. */
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
  /** The card's Reports / Send as icons only, so they share one row with the
   *  bin (MobileCardList `iconActions`). */
  iconActions?: boolean;
  /**
   * CARD VIEW / LIST VIEW (user 2026-10-16, `ViewToggle`). When given, it
   * decides the drawing and `table` only names the list's columns — so a screen
   * offering the switch passes `table` on EVERY tab. Omitted, `table`'s presence
   * decides as before, and a screen with no switch is unchanged.
   */
  view?: ViewMode;
}) {
  /* EVERY LISTING PAGES ITSELF (AGENTS "Pagination"). The table mode's
     DataTable already does; the card grid did not, so a long Pending pile
     printed every card. Called above the table branch — hooks never sit below
     an early return. */
  const pg = usePagination(rows);
  if (table && (view ? view === "list" : true)) {
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
                {/* Reports, then the screen's own answers (Approve, Reject), then Send /
                    Revise — the card's order too (user 2026-10-22, screenshot 3661). */}
                {actions?.(r)}
                {onSend && canSendRow?.(r) !== false ? (
                  <RowIconAction label={sendLabel} icon={sendIcon} className="text-primary" onClick={() => onSend(r)} />
                ) : null}
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
      <div>
        <DataTable columns={hugCreated(withCreatedColumns(cols, rows))} rows={rows} compact getKey={getKey} empty={empty} />
      </div>
    );
  }
  const pager = pg.pageCount > 1 && (
    <PaginationBar
      page={pg.page}
      pageCount={pg.pageCount}
      total={pg.total}
      pageSize={pg.pageSize}
      onPageChange={pg.setPage}
      onPageSizeChange={pg.setPageSize}
    />
  );
  if (renderCard) {
    return (
      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          /* `pb-3`: room for the glow under the last row of cards. */
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 pb-3">
            {pg.paged.map((r) => (
              <Fragment key={getKey(r)}>{renderCard(r)}</Fragment>
            ))}
          </div>
        )}
        {pager}
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
      // An ICON on the card, the word in its tooltip (components/ui/status-mark.tsx).
      pill={pillText ? (r) => <StatusMark word={((x) => (typeof x === "string" ? x : ""))(pillText(r))} mark={mark?.(r)} tone={TONE[state(r)]} /> : undefined}
      stats={stats}
      selected={selected}
      footerNote={footerNote}
      onEdit={onOpen}
      canDelete={canDelete}
      canDeleteRow={canDeleteRow}
      deleteDisabledReason={deleteDisabledReason}
      extraActions={actions}
      // Report first, then Approve / Reject (user 2026-10-22, screenshot 3661).
      extraActionsAfterReports
      onDelete={onDelete}
      onReports={onReports}
      canReportsRow={canReportsRow}
      onSend={onSend}
      canSendRow={canSendRow}
      /* The card names its buttons in words, and a sixth of the pane has room for one. */
      sendLabel={cardSendLabel}
      sendIcon={sendIcon}
      iconActions={iconActions}
      isPending={isPending}
      empty={empty}
    />
      {/* The bar draws only past one page, as under every DataTable. */}
      {pager}
    </div>
  );
}
