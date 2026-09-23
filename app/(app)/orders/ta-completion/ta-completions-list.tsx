"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Users } from "lucide-react";
import type { TaCompletionRow } from "@/lib/orders/ta-completion/service";
import { fmtDate } from "@/lib/format";
import { Truncated } from "@/components/ui/truncated";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import {
  createdByFacet,
  createdDateFacet,
  flagFacet,
  useFacetFilter,
  type FacetGroup,
} from "@/components/ui/filter-drawer";

const columns: Column<TaCompletionRow>[] = [
  {
    header: "Completion No",
    cell: (row) => (
      <span className="font-mono text-xs font-medium text-primary">
        {row.code ?? "—"}
      </span>
    ),
  },
  {
    header: "RE No",
    cell: (row) => (
      <span className="font-mono text-xs">
        {row.sales_orders?.order_number ?? "—"}
      </span>
    ),
  },
  {
    header: "Customer",
    cell: (row) => (
      <span className="text-sm">{row.sales_orders?.buyers?.name ?? "—"}</span>
    ),
  },
  {
    header: "Order No",
    cell: (row) => <span className="text-sm">{row.order_no ?? "—"}</span>,
  },
  {
    header: "Date",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {fmtDate(row.completion_date)}
      </span>
    ),
  },
  {
    header: "Remarks",
    cell: (row) => (
      // `truncate` + a `title` is an ellipsis with a tooltip the keyboard and
      // touch can never reach. <Truncated> writes the clamp itself, measures the
      // box, and reveals on hover OR press-and-hold — and only when something is
      // actually hidden (AGENTS.md, "Truncated values").
      <Truncated
        text={row.remarks ?? "—"}
        className="block max-w-[16rem] text-sm text-muted-foreground"
      />
    ),
  },
  /* View only. This list has no detail route to edit into, and no delete action
     exists for the record — the eye still earns its place: it answers "what is in
     this row?" without opening anything. */
  rowActionsColumn((row) => <RowActions label={row.code} />),
];

/**
 * THE GROUPED DRAWER (user, 2026-09-23: "implement the Material BOM filter in
 * every Orders child"). This list had no filter at all; every facet reads a
 * field the row already carries, so none costs a query. A TA completion has no
 * status of its own (every row IS a completion) and no delivery date, so the
 * two questions are "when" and "whose".
 */
const TA_COMPLETION_FACETS: FacetGroup<TaCompletionRow>[] = [
  {
    title: "Dates",
    icon: <CalendarRange />,
    facets: [
      { key: "completed", label: "Completion Date", all: "Any date", wide: true, date: (r) => r.completion_date },
      createdDateFacet(),
      createdByFacet(),
    ],
  },
  {
    title: "Customer & year",
    icon: <Users />,
    facets: [
      {
        key: "customer",
        label: "Customer",
        all: "All customers",
        wide: true,
        value: (r) => r.sales_orders?.buyers?.name,
      },
      {
        key: "year",
        label: "Year",
        all: "Any year",
        value: (r) => (r.completion_year != null ? String(r.completion_year) : null),
      },
      flagFacet("remarks", "Remarks", (r) => !!r.remarks?.trim(), "Has remarks", "No remarks"),
    ],
  },
];

/**
 * The list half of the page, client-side so it can hold the filter state.
 * The page stays a server component and passes plain rows; the columns (cell
 * FUNCTIONS) live here, where they never cross the server→client boundary.
 */
export function TaCompletionsList({ rows }: { rows: TaCompletionRow[] }) {
  const [query, setQuery] = useState("");
  const facets = useFacetFilter(rows, TA_COMPLETION_FACETS);
  const matchesFacets = facets.matches;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchesFacets(r)) return false;
      if (!needle) return true;
      return [r.code, r.sales_orders?.order_number, r.order_no, r.sales_orders?.buyers?.name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [rows, query, matchesFacets]);

  return (
    <div className="space-y-3">
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search Completion No, RE No, Order No or customer…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
      />
      <DataTable
        columns={withCreatedColumns(columns, rows)}
        rows={filtered}
        getKey={(row) => row.id}
        empty={rows.length ? "No TA completions match these filters." : "No TA completions yet."}
      />
    </div>
  );
}
