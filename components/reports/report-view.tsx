"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ReportToolbar, type ReportView as ViewMode } from "./report-toolbar";
import { ReportChart } from "./report-chart";
import type { ReportConfig } from "@/lib/reports/types";

/**
 * Generic report shell. Given a `ReportConfig` (built in a client wrapper, since it
 * carries functions that can't cross the server boundary), it renders the export/print
 * toolbar and either the data table or the chart. The visible content sits inside
 * `.report-print-area` so Print isolates it from the app shell (see globals.css).
 */
export function ReportView<T>({
  config,
  getKey,
  empty = "No data for this report.",
}: {
  config: ReportConfig<T>;
  getKey: (row: T, index: number) => string;
  empty?: string;
}) {
  const [view, setView] = useState<ViewMode>("table");
  const showChart = view === "chart" && !!config.chart;

  // Map export-safe report columns onto the presentational DataTable columns.
  const columns: Column<T>[] = config.columns.map((c) => ({
    header: c.header,
    align: c.isNumeric ? "right" : c.align,
    cell: (row: T) => (
      <span className={c.isNumeric ? "tabular-nums" : undefined}>
        {c.value(row)}
      </span>
    ),
  }));

  return (
    <div className="space-y-4">
      <ReportToolbar
        config={config}
        view={view}
        onViewChange={setView}
        hasChart={!!config.chart}
      />

      <div className="report-print-area space-y-3">
        {/* Print-only heading — the on-screen title lives in the page's PageHeader. */}
        <h2 className="hidden text-lg font-semibold print:block">{config.title}</h2>

        {showChart ? (
          <ReportChart config={config} />
        ) : (
          <DataTable columns={columns} rows={config.rows} getKey={getKey} empty={empty} />
        )}
      </div>
    </div>
  );
}
