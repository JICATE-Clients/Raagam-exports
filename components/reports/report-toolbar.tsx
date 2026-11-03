"use client";

import { useState, type ReactNode } from "react";
import { Printer, BarChart3, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DownloadMenu, asExcel, asPdf } from "@/components/ui/download-menu";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { usePermission } from "@/lib/auth/permission-context";
import { exportPdf } from "@/lib/reports/export-pdf";
import { exportExcel } from "@/lib/reports/export-excel";
import type { ReportConfig } from "@/lib/reports/types";

export type ReportView = "table" | "chart";

/**
 * Actions bar for a report: PDF / Excel export (gated by `reports:export`), Print,
 * and a Table/Chart toggle. Hidden from print output via `print:hidden`.
 *
 * ONE ROW WITH THE REPORT'S OWN CONTROLS (user 2026-11-03, screenshot 4031: the
 * reports "look unaligned" — the as-on date, the search + Filters and Download /
 * Print were three bands stacked above the table). `leading` takes the screen's
 * controls on the left; the view switch, Download and Print sit on the right of
 * the same row. Every control is `md` (36px) now, the search Input's height —
 * LAYOUT.md §10 "The header row" — so the `sm` exemption this file carried is gone.
 */
export function ReportToolbar<T>({
  config,
  view,
  onViewChange,
  hasChart,
  leading,
}: {
  config: ReportConfig<T>;
  view: ReportView;
  onViewChange: (v: ReportView) => void;
  hasChart: boolean;
  /** The report's own controls (as-on date, search, Filters) — left of the actions. */
  leading?: ReactNode;
}) {
  const canExport = usePermission("reports", "export");
  // Was `react-hot-toast` — the only consumer in the app, which meant report
  // errors appeared top-right while every other message in the ERP appeared
  // bottom-left-of-corner. One toast system now.
  const { error } = useToast();
  const [busy, setBusy] = useState(false);
  const empty = config.rows.length === 0;

  function handlePdf() {
    try {
      exportPdf(config);
    } catch (err) {
      console.error(err);
      error("Could not generate PDF.");
    }
  }

  async function handleExcel() {
    setBusy(true);
    try {
      await exportExcel(config);
    } catch (err) {
      console.error(err);
      error("Could not generate Excel file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-2 print:hidden">
      {/* The report's controls take the row's spare width; a Filters panel opens under them. */}
      <div className="min-w-0 flex-1">{leading}</div>

      <div className="flex items-center gap-2">
        {hasChart ? (
          <ToggleGroup
            label="View"
            value={view}
            onChange={onViewChange}
            options={[
              { value: "table", label: "Table", icon: Table2 },
              { value: "chart", label: "Chart", icon: BarChart3 },
            ]}
          />
        ) : null}
        {/* PDF and Excel in one Download menu (user 2026-10-16, "globally fix"). */}
        {canExport && (
          <DownloadMenu disabled={empty || busy} busyLabel="Exporting…" formats={[asPdf(handlePdf), asExcel(handleExcel)]} />
        )}
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>
    </div>
  );
}
