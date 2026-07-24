"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRegisterShortcut } from "@/lib/shortcuts";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import { FilterBar } from "@/components/masters/filter-bar";
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
  /** Desktop table columns, including the row-actions column. */
  columns: Column<Row>[];
  empty?: ReactNode;
  mobile: {
    title: (r: Row) => ReactNode;
    subtitle?: (r: Row) => ReactNode;
    pill?: (r: Row) => ReactNode;
    meta?: (r: Row) => ReactNode;
    onEdit?: (r: Row) => void;
    onDelete?: (r: Row) => void;
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
 * MobileCardList (with delete), PaginationBar — plus the module's single
 * `useCreateIntent` hookup so the mobile ＋ (`?new=1`) opens the editor.
 * The screen keeps owning its editor surface (Sheet / MasterFullScreen) and
 * its row actions; this component only owns the list around it.
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

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter<
    Row,
    Record<string, string>
  >(rows, {
    search: (r, q) => searchText(r).toLowerCase().includes(q),
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
            hasFacets
              ? () => {
                  reset();
                  pg.setPage(1);
                }
              : undefined
          }
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

      <div className="hidden space-y-3 md:block">
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
          columns={columns}
          rows={pg.paged}
          getKey={(r) => getKey(r)}
          empty={empty}
          selectable={!!bulkEntityKey}
          selectedKeys={bulkEntityKey ? sel.selectedKeys : undefined}
          onToggle={bulkEntityKey ? sel.toggle : undefined}
          onToggleAll={bulkEntityKey ? () => sel.toggleAll(pg.paged.map((r) => getKey(r))) : undefined}
        />
      </div>

      <div className="md:hidden">
        <MobileCardList
          rows={pg.paged}
          getKey={getKey}
          title={mobile.title}
          subtitle={mobile.subtitle}
          pill={mobile.pill}
          meta={mobile.meta}
          onEdit={perms.canEdit ? mobile.onEdit : undefined}
          canDelete={perms.canDelete}
          onDelete={mobile.onDelete}
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
    </div>
  );
}
