"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, type RowMenuItem } from "@/components/ui/row-actions";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { StatusToggle } from "@/components/ui/status-toggle";
import { StatusPill } from "@/components/ui/status-pill";
import {
  rowActionsColumn,
  ROW_ACTIONS_MENU_WIDTH,
} from "@/components/ui/row-actions-column";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";
import {
  RecordViewSheet,
  type ViewPair,
  type ViewSection,
} from "@/components/masters/record-view-sheet";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRegisterShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  createdMeta,
  createdSection,
  hasCreatedInfo,
  withCreatedColumns,
} from "@/components/ui/created-columns";
import { MobileCardList } from "@/components/masters/mobile-card-list";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { BulkActionsBar } from "@/components/data-io/bulk-actions-bar";

export type MasterStatus = "active" | "inactive" | "draft";

export type ShellExtraFilter<Row> = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  predicate: (r: Row, v: string) => boolean;
};

export type MasterListShellProps<Row> = {
  rows: Row[];
  getKey: (r: Row) => string;
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; canImport?: boolean };
  /** Free-text haystack per row (lowercased match is handled internally). */
  searchText: (r: Row) => string;
  searchPlaceholder?: string;
  /**
   * Provide to get the standard Status facet (All/Active/Inactive, +Draft when
   * any row reports "draft"). Omit for screens without a status concept.
   */
  statusOf?: (r: Row) => MasterStatus;
  extraFilters?: ShellExtraFilter<Row>[];
  /** DataIoToolbar entity key — omit to hide import/export. */
  ioEntityKey?: string;
  /** "+ Add Beam Type" — omit (with onAdd) to hide the add button. */
  addLabel?: string;
  /** Opens the screen's editor; also the `?new=1` create-intent target. */
  onAdd?: () => void;
  /**
   * Desktop table columns — DATA columns only. Pass `rowActions` for the
   * trailing View/Edit/Delete cell rather than appending it here, so every list
   * in the app shares one action-column geometry.
   */
  columns: Column<Row>[];
  /**
   * Row CRUD. Hand over the HANDLERS, not a rendered cell: the shell builds the
   * `<RowActions>` itself, appends it through `rowActionsColumn()`, gates it on
   * `perms`, derives the aria-labels from `rowLabel`, and feeds the same three
   * handlers to the mobile card. A screen therefore cannot give its rows a
   * different action set, a different confirm step or a different column width
   * from every other list — which is exactly how 131 screens drifted into six
   * dialects when each one rendered its own cell.
   *
   * `onView` is what puts an eye on the row; omit it only when the table already
   * shows everything the record holds.
   */
  actions?: {
    onView?: (r: Row) => void;
    onEdit?: (r: Row) => void;
    onDelete?: (r: Row) => void;
    /**
     * SWITCH THE ROW ON OR OFF FROM THE LISTING, and — by being present at all
     * — give this list a Status column of switches.
     *
     * `active` is stated positively: true means the row should be ON. That is
     * the convention `setMasterActive` and `activePatch` already use, and
     * `lib/masters/inactive.ts` records why it matters — two of the schema's
     * three spellings are negated, so a caller that inverts the boolean itself
     * is one copy-paste from switching a row on when it meant to switch it off.
     * `useBlockAction().setStatus` is the handler to pass; it does the write,
     * the toast and the refresh.
     *
     * ## THE COLUMN IS SPLICED HERE, NOT DECLARED BY THE SCREEN
     *
     * Same rule as the Created pair and the actions cell beside it: the header,
     * the width, the switch, its colour and the word next to it are the shell's,
     * so forty listings cannot drift into forty status cells. A screen that
     * still declares its own `Status` column gets it STRIPPED, deliberately —
     * exactly as `withCreatedColumns` strips a hand-rolled Created column, and
     * for the same reason: two Status columns is a worse failure than a screen
     * silently losing a cell it no longer owns.
     *
     * It lands AFTER the Created pair because `withCreatedColumns` walks back
     * over a trailing `Status` header to place its own — so the documented order
     * (data, Created Date, Created User, Status, actions) falls out rather than
     * being re-stated here.
     *
     * ## IT DOES NOT PICK THE ACTIONS CELL — `variant` DOES
     *
     * For one day this prop did both, on the reasoning that the menu was what
     * carried the status. The client reversed that on 2026-09-11: the status is
     * a column again and the menu holds only View / Edit / Delete. The two facts
     * really are independent now, so they are two props — a list can have
     * switches and inline icons, or a menu and no status at all.
     *
     * The screen that adopts this should still drop its Inactive FIELD (client
     * 2026-08-17: "no more in the creating screen"). That half is unchanged and
     * is not done for it here: this component cannot see the screen's form.
     */
    onStatusChange?: (r: Row, active: boolean) => void;
    /**
     * Which actions cell this list gets: three inline icons (`RowActions`, the
     * default and what ~131 listings render) or one collapsed `⋮` menu
     * (`TableRowActionsMenu`).
     *
     * Opt-in per screen rather than flipped app-wide, because changing the cell
     * on every master at once is not a thing to do as a side effect of adding it
     * to one. Associates is the module being moved over first.
     */
    variant?: "icons" | "menu";
    /** Extra items behind a `⋮` — Duplicate, Export row. Never Delete. */
    menu?: (r: Row) => RowMenuItem[];
  };
  /**
   * The row's name, folded into every action's aria-label ("Edit CHENNAI").
   * Defaults to `mobile.title` when that returns a plain string — set it when
   * the mobile title is JSX, or when a different field reads better aloud.
   */
  rowLabel?: (r: Row) => string;
  /**
   * The read-only view behind the row's eye.
   *
   * DOING NOTHING GIVES YOU ONE. Every list gets a view built from `columns` —
   * each header becomes a label and each `cell(row)` its value — because the
   * alternative was the status quo: 12 of ~62 master screens had a View and on
   * the other 50 the only way to read a record was to open its editor. A
   * columns-derived view is shallower than a hand-written one, and still
   * strictly better than that.
   *
   * `sections` appends the fields the LIST does not show, which is where the
   * real value is — the record behind six columns routinely holds forty.
   * `false` suppresses the eye, for a register whose columns already are the
   * whole record. A screen with a bespoke sheet passes `actions.onView`
   * instead, and that always wins.
   */
  view?: false | { sections?: (r: Row) => ViewSection[] };
  empty?: ReactNode;
  mobile: {
    title: (r: Row) => ReactNode;
    subtitle?: (r: Row) => ReactNode;
    pill?: (r: Row) => ReactNode;
    meta?: (r: Row) => ReactNode;
    onEdit?: (r: Row) => void;
    onDelete?: (r: Row) => void;
    /**
     * Read-only view (eye in the card footer). Wire it wherever the desktop
     * table has one — on a phone the card tap IS edit, so without this there is
     * no way to just look at a record. `MobileCardList` has supported it since
     * it was extracted; the shell simply never passed it through.
     */
    onView?: (r: Row) => void;
  };
  isPending?: boolean;
  /** Rare per-screen extra toolbar buttons (rendered next to Add). */
  toolbarExtra?: ReactNode;
  /**
   * data-io entity key — when set, the desktop table gains row multi-select and
   * a bulk-actions bar (Deactivate / Activate / Export selected). Omit to keep
   * the list single-action. Independent of `ioEntityKey` (import/export toolbar).
   */
  bulkEntityKey?: string;
  /** Noun for bulk toasts, e.g. "banks". Defaults to "records". */
  bulkLabel?: string;
};

/**
 * Standard list chrome for a master screen: FilterBar (search + Status +
 * extra facets), DataIoToolbar, Add button, desktop DataTable, mobile
 * MobileCardList (with view + delete), PaginationBar — plus the module's single
 * `useCreateIntent` hookup so the mobile ＋ (`?new=1`) opens the editor.
 *
 * The screen keeps owning its editor surface (Sheet / MasterFullScreen). It no
 * longer owns the row-actions COLUMN: it hands over a `rowActions` renderer and
 * the shell appends `rowActionsColumn()` itself (client 2026-07-30). Letting
 * each screen append that column is how 131 of them ended up with six different
 * action dialects and four ways of confirming a delete.
 */
export function MasterListShell<Row>({
  rows,
  getKey,
  perms,
  searchText,
  searchPlaceholder = "Search…",
  statusOf,
  extraFilters,
  ioEntityKey,
  addLabel,
  onAdd,
  columns,
  actions,
  rowLabel,
  view,
  empty = "No records yet.",
  mobile,
  isPending = false,
  toolbarExtra,
  bulkEntityKey,
  bulkLabel,
}: MasterListShellProps<Row>) {
  const hasDraft = useMemo(
    () => !!statusOf && rows.some((r) => statusOf(r) === "draft"),
    [rows, statusOf],
  );

  // Row opened in the auto-built view sheet. Holds the row itself — the sheet
  // renders what the list already selected, so there is nothing to fetch.
  const [viewRow, setViewRow] = useState<Row | null>(null);

  const nameOf = useCallback(
    (r: Row) => {
      if (rowLabel) return rowLabel(r);
      const t = mobile.title(r);
      return typeof t === "string" ? t : "";
    },
    [rowLabel, mobile],
  );

  // A screen's own view sheet wins; otherwise the columns-derived one fills in.
  const autoView = view !== false && !actions?.onView;
  const onView = actions?.onView ?? (autoView ? setViewRow : undefined);

  // Does the data carry creation info? The SAME gate the Created Date facet
  // uses, so the column and the filter appear and disappear together.
  const showCreated = useMemo(() => hasCreatedInfo(rows), [rows]);

  /**
   * The Status column of switches — present exactly when the screen declared
   * `onStatusChange`. See that prop for why the shell owns this cell.
   *
   * Held as its own reference rather than found again by header text, because
   * the read-only view sheet below has to recognise it: a `RecordViewSheet` that
   * rendered this cell verbatim would put a LIVE switch inside a surface whose
   * whole promise is that looking at a record cannot change it.
   */
  const statusColumn = useMemo<Column<Row> | null>(() => {
    const onStatusChange = actions?.onStatusChange;
    if (!onStatusChange) return null;
    return {
      header: "Status",
      className: "w-32",
      cell: (r) => (
        <StatusToggle
          // `Row` is generic here and the switch wants a row it can read a
          // status off. The cast is safe in the direction that matters:
          // `isInactive` answers false for a row carrying none of the three
          // spellings, so a screen that declares `onStatusChange` over a
          // flagless table gets "Active", not a crash.
          row={r as Deactivatable}
          label={nameOf(r)}
          // Draft is the one state a two-position switch cannot express, and it
          // is read off the facet the screen ALREADY declares rather than a
          // second prop — `statusOf` is the same function the Status filter
          // above the list runs, so the pill and the facet cannot disagree about
          // which rows are drafts. A list with no `statusOf` has no draft state
          // and the pill never appears.
          draft={statusOf?.(r) === "draft"}
          // Blocking is the destructive direction and `setMasterActive` gates it
          // as `delete` server-side. Same gate `useBlockAction`'s `canBlock`
          // takes, so the two controls cannot disagree about who may block a row.
          disabled={!perms.canDelete || isPending}
          onChange={(active) => onStatusChange(r, active)}
        />
      ),
    };
  }, [actions, nameOf, statusOf, perms.canDelete, isPending]);

  // The screen's columns, plus the Status switch, plus the Created pair spliced
  // in ahead of it. Kept separate from `tableColumns` because the derived view
  // sheet below wants the DATA columns without the actions one.
  const dataColumns = useMemo(() => {
    // A screen's own Status column is REPLACED, not appended to — see the note
    // on `actions.onStatusChange`.
    const base = statusColumn
      ? [...columns.filter((c) => !/^\s*status\s*$/i.test(c.header ?? "")), statusColumn]
      : columns;
    return withCreatedColumns(base, rows);
  }, [columns, rows, statusColumn]);

  // The Created line is APPENDED to the mobile card, not substituted for the
  // screen's own meta — the card has room for both, and dropping the screen's
  // line to make space would hide something the desktop table still shows.
  const cardMeta = useMemo(() => {
    if (!showCreated) return mobile.meta;
    return (r: Row) => (
      <>
        {mobile.meta?.(r)}
        <div className={mobile.meta ? "mt-0.5" : undefined}>{createdMeta(r)}</div>
      </>
    );
  }, [showCreated, mobile.meta]);

  // The actions column is appended here, not declared by the screen, so its
  // header/alignment/width are the same on every list in the app.
  const tableColumns = useMemo(() => {
    if (!actions && !autoView) return dataColumns;

    // The collapsed form — opted into per screen; see `actions.variant`.
    if (actions?.variant === "menu") {
      return [
        ...dataColumns,
        rowActionsColumn<Row>(
          (r) => (
            <TableRowActionsMenu
              label={nameOf(r)}
              onView={onView && (() => onView(r))}
              onEdit={actions?.onEdit && (() => actions.onEdit!(r))}
              onDelete={actions?.onDelete && (() => actions.onDelete!(r))}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
              isPending={isPending}
              menu={actions?.menu?.(r) ?? []}
            />
          ),
          ROW_ACTIONS_MENU_WIDTH,
        ),
      ];
    }

    return [
      ...dataColumns,
      rowActionsColumn<Row>((r) => (
        <RowActions
          label={nameOf(r)}
          onView={onView && (() => onView(r))}
          onEdit={actions?.onEdit && (() => actions.onEdit!(r))}
          onDelete={actions?.onDelete && (() => actions.onDelete!(r))}
          canEdit={perms.canEdit}
          canDelete={perms.canDelete}
          isPending={isPending}
          menu={actions?.menu?.(r) ?? []}
        />
      )),
    ];
  }, [dataColumns, actions, autoView, onView, nameOf, perms.canEdit, perms.canDelete, isPending]);

  /**
   * DIM A ROW THAT IS SWITCHED OFF.
   *
   * Only for a listing that carries the Status switch. The switch and the word
   * beside it already say which state the row is in; this says it in a way that
   * survives being scanned rather than read, so a blocked row is findable in
   * forty without checking forty switches.
   *
   * Listings that do not declare `onStatusChange` are left alone — dimming ~62
   * existing lists is a change nobody asked for, and their pill already says it.
   *
   * `opacity-60` rather than a text colour: the row holds pills, links and an
   * icon button as well as text, and a `text-*` class reaches none of them.
   *
   * IT DIMS THE DATA CELLS AND NOT THE LAST ONE, which is the actions cell.
   * Opacity on the `<tr>` would take the `—` button down with the text, and a
   * child cannot be made brighter than its parent again — `opacity` composites
   * the whole subtree, so `[&>td:last-child]:opacity-100` does nothing. The
   * control that switches the row back ON is the one thing on a dimmed row that
   * must stay fully legible, so the dimming is applied per cell instead.
   */
  const rowClassName = useMemo(() => {
    if (!actions?.onStatusChange) return undefined;
    return (r: Row) =>
      isInactive(r as Deactivatable) ? "[&>td:not(:last-child)]:opacity-60" : undefined;
  }, [actions]);

  /**
   * THE STATUS AS A PILL, for the read-only view sheet.
   *
   * The table cell is a live switch, and `RecordViewSheet` derives its pairs by
   * calling each column's `cell` — so rendering that column verbatim would put a
   * working control inside a surface whose whole promise is that looking at a
   * record cannot change it. This is what the sheet shows instead.
   *
   * It reads `statusOf` where the screen declared one, so a THIRD state the
   * switch cannot express (Draft) is still reported here. Falling back to
   * `isInactive` keeps it correct for a list with switches and no status facet.
   */
  const statusPairValue = useCallback(
    (r: Row) => {
      const s = statusOf?.(r) ?? (isInactive(r as Deactivatable) ? "inactive" : "active");
      const tone = s === "draft" ? "warning" : s === "inactive" ? "danger" : "success";
      const text = s === "draft" ? "Draft" : s === "inactive" ? "Inactive" : "Active";
      return <StatusPill tone={tone}>{text}</StatusPill>;
    },
    [statusOf],
  );

  const filterConfig = useMemo(() => {
    const filters: Record<string, (r: Row, v: string) => boolean> = {};
    const initialFilters: Record<string, string> = {};
    if (statusOf) {
      filters.status = (r, v) => statusOf(r) === v;
      initialFilters.status = "";
    }
    for (const f of extraFilters ?? []) {
      filters[f.key] = f.predicate;
      initialFilters[f.key] = "";
    }
    return { filters, initialFilters };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusOf, extraFilters]);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, isStale, dateFilter } = useMasterFilter<
    Row,
    Record<string, string>
  >(rows, {
    searchKey: searchText,
    filters: filterConfig.filters,
    initialFilters: filterConfig.initialFilters,
  });

  const pg = usePagination(filtered, 10);

  useCreateIntent(() => {
    if (perms.canCreate) onAdd?.();
  });

  // Global keyboard shortcuts (checklist): Ctrl+N adds a record, Ctrl+F focuses
  // the search box. Registered only when the corresponding action is available.
  const searchRef = useRef<HTMLInputElement>(null);
  useRegisterShortcut("new", () => onAdd?.(), perms.canCreate && !!onAdd);
  useRegisterShortcut("search", () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  });

  // Opt-in desktop multi-select + bulk actions (only when bulkEntityKey given).
  const sel = useRowSelection();
  const rowByKey = useMemo(() => {
    const m = new Map<string, Row>();
    rows.forEach((r) => m.set(getKey(r), r));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const selectedRows = useMemo(
    () => sel.selectedIds.map((id) => rowByKey.get(id)).filter(Boolean) as Row[],
    [sel.selectedIds, rowByKey],
  );

  const hasFacets = !!statusOf || (extraFilters?.length ?? 0) > 0;
  // Created Date counts as a filter for the Reset link — a list whose only facet
  // is the date still needs a way back to "everything".
  const canReset = hasFacets || dateFilter.enabled;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          searchRef={searchRef}
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder={searchPlaceholder}
          activeCount={activeCount}
          onReset={
            canReset
              ? () => {
                  reset();
                  pg.setPage(1);
                }
              : undefined
          }
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
        >
          {hasFacets ? (
            <>
              {statusOf && (
                <div>
                  <Label htmlFor="mls-filter-status">Status</Label>
                  <Select
                    id="mls-filter-status"
                    value={filterValues.status ?? ""}
                    onChange={(e) => {
                      setFilter("status", e.target.value);
                      pg.setPage(1);
                    }}
                    className="text-base md:text-sm"
                  >
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    {hasDraft && <option value="draft">Draft</option>}
                  </Select>
                </div>
              )}
              {(extraFilters ?? []).map((f) => (
                <div key={f.key}>
                  <Label htmlFor={`mls-filter-${f.key}`}>{f.label}</Label>
                  <Select
                    id={`mls-filter-${f.key}`}
                    value={filterValues[f.key] ?? ""}
                    onChange={(e) => {
                      setFilter(f.key, e.target.value);
                      pg.setPage(1);
                    }}
                    className="text-base md:text-sm"
                  >
                    <option value="">All</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </>
          ) : undefined}
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          {ioEntityKey && (
            <DataIoToolbar
              entityKey={ioEntityKey}
              rows={filtered}
              canExport={perms.canExport}
              canImport={perms.canImport}
            />
          )}
          {toolbarExtra}
          {perms.canCreate && onAdd && addLabel && (
            <Button size="md" onClick={onAdd}>
              {addLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Dimmed while the deferred filter catches up — see useMasterFilter. */}
      <div className={cn("hidden space-y-3 transition-opacity md:block", isStale && "opacity-60")}>
        {bulkEntityKey && sel.selectedIds.length > 0 && (
          <BulkActionsBar
            entityKey={bulkEntityKey}
            selectedIds={sel.selectedIds}
            selectedRows={selectedRows as Record<string, unknown>[]}
            onClear={sel.clear}
            label={bulkLabel}
            canDelete={perms.canDelete}
            canEdit={perms.canEdit}
            canExport={perms.canExport}
          />
        )}
        <DataTable
          columns={tableColumns}
          rows={pg.paged}
          getKey={(r) => getKey(r)}
          rowClassName={rowClassName}
          empty={empty}
          selectable={!!bulkEntityKey}
          selectedKeys={bulkEntityKey ? sel.selectedKeys : undefined}
          onToggle={bulkEntityKey ? sel.toggle : undefined}
          onToggleAll={bulkEntityKey ? () => sel.toggleAll(pg.paged.map((r) => getKey(r))) : undefined}
        />
      </div>

      {/* Desktop and mobile read the SAME handlers, so a screen cannot ship a
          View on one and not the other — which is how only 2 of ~62 screens
          ended up with a mobile view. `mobile.*` stays as the fallback for
          screens not yet moved onto `actions`. */}
      <div className={cn("transition-opacity md:hidden", isStale && "opacity-60")}>
        <MobileCardList
          rows={pg.paged}
          getKey={getKey}
          title={mobile.title}
          subtitle={mobile.subtitle}
          pill={mobile.pill}
          meta={cardMeta}
          onView={actions?.onView ?? mobile.onView}
          onEdit={perms.canEdit ? actions?.onEdit ?? mobile.onEdit : undefined}
          canDelete={perms.canDelete}
          onDelete={actions?.onDelete ?? mobile.onDelete}
          isPending={isPending}
          empty={empty}
        />
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* Columns-derived read-only view. Headerless columns are skipped — an
          unlabelled column is a control or a spacer, not a field. No Edit in the
          footer; see record-view-sheet.tsx. */}
      {autoView && viewRow && (
        <RecordViewSheet
          open
          onClose={() => setViewRow(null)}
          title={nameOf(viewRow) || "Record"}
          sections={[
            {
              label: "Details",
              // The Created pair is stripped back out here and re-added below as
              // its own section, so the sheet words it exactly as the table does
              // and an unknown creator drops out (the sheet hides empty pairs;
              // a table cell has to show the dash).
              // The Status column is the one cell that is NOT rendered as the
              // table renders it — see `statusPairValue`.
              pairs: dataColumns
                .filter((c) => !!c.header && !/^created\s/i.test(c.header))
                .map(
                  (c) =>
                    [
                      c.header,
                      c === statusColumn ? statusPairValue(viewRow) : c.cell(viewRow),
                    ] as ViewPair,
                ),
            },
            ...(typeof view === "object" ? view.sections?.(viewRow) ?? [] : []),
            ...createdSection(viewRow),
          ]}
        />
      )}
    </div>
  );
}
