"use client";

import { useState } from "react";
import { FileText, Sheet, Printer, BarChart3, Table2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { usePermission } from "@/lib/auth/permission-context";
import { exportPdf } from "@/lib/reports/export-pdf";
import { exportExcel } from "@/lib/reports/export-excel";
import type { ReportConfig } from "@/lib/reports/types";

export type ReportView = "table" | "chart";

/**
 * Actions bar for a report: PDF / Excel export (gated by `reports:export`), Print,
 * and a Table/Chart toggle. Hidden from print output via `print:hidden`.
 */
export function ReportToolbar<T>({
  config,
  view,
  onViewChange,
  hasChart,
}: {
  config: ReportConfig<T>;
  view: ReportView;
  onViewChange: (v: ReportView) => void;
  hasChart: boolean;
}) {
  const canExport = usePermission("reports", "export");
  const [busy, setBusy] = useState(false);
  const empty = config.rows.length === 0;

  function handlePdf() {
    try {
      exportPdf(config);
    } catch (err) {
      console.error(err);
      toast.error("Could not generate PDF.");
    }
  }

  async function handleExcel() {
    setBusy(true);
    try {
      await exportExcel(config);
    } catch (err) {
      console.error(err);
      toast.error("Could not generate Excel file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
      {hasChart ? (
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
          <Button
            variant={view === "table" ? "subtle" : "ghost"}
            size="sm"
            onClick={() => onViewChange("table")}
          >
            <Table2 className="h-4 w-4" />
            Table
          </Button>
          <Button
            variant={view === "chart" ? "subtle" : "ghost"}
            size="sm"
            onClick={() => onViewChange("chart")}
          >
            <BarChart3 className="h-4 w-4" />
            Chart
          </Button>
        </div>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-2">
        {canExport && (
          <>
            <Button variant="outline" size="sm" onClick={handlePdf} disabled={empty}>
              <FileText className="h-4 w-4" />
              PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExcel}
              disabled={empty || busy}
            >
              <Sheet className="h-4 w-4" />
              {busy ? "Exporting…" : "Excel"}
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>
    </div>
  );
}
