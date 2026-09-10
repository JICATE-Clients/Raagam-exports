"use client";

import { ReportView } from "@/components/reports/report-view";
import type { ReportConfig } from "@/lib/reports/types";
import type { StaffKpiRow } from "@/lib/ta/kpi";

/**
 * Client wrapper turning the server-fetched KPI rows into a `ReportConfig` —
 * the same split every other report in this module uses (see
 * `shipment-pnl-report.tsx`): the config carries `value()` closures and a
 * chart spec, so it has to be built where React can hold functions, not
 * passed across the server/client boundary as data.
 */
export function TaPerformanceReport({
  rows,
  from,
  to,
}: {
  rows: StaffKpiRow[];
  from: string;
  to: string;
}) {
  const config: ReportConfig<StaffKpiRow> = {
    title: "T&A Staff Performance",
    subtitle: `${from} to ${to}`,
    rows,
    columns: [
      { key: "staffName", header: "Staff", value: (r) => r.staffName },
      {
        key: "totalAssigned",
        header: "Assigned",
        isNumeric: true,
        value: (r) => r.totalAssigned,
      },
      {
        key: "completedOnTime",
        header: "On time",
        isNumeric: true,
        value: (r) => r.completedOnTime,
      },
      {
        key: "completedLate",
        header: "Late",
        isNumeric: true,
        value: (r) => r.completedLate,
      },
      {
        key: "buyerAttributedDelays",
        header: "Buyer-attributed",
        isNumeric: true,
        value: (r) => r.buyerAttributedDelays,
      },
      {
        key: "stillOpen",
        header: "Still open",
        isNumeric: true,
        value: (r) => r.stillOpen,
      },
      {
        key: "onTimeScorePercentage",
        header: "On-time %",
        isNumeric: true,
        // RAW number to Excel (so it sums/sorts correctly — see ReportColumn's
        // own note on why `format` exists), "%" only for screen and PDF, and a
        // blank rather than 0 when nothing has been completed yet: a 0% score
        // reads as a failing month, an empty cell reads as "no data yet",
        // which is the honest state of a row with 0 completions.
        value: (r) => r.onTimeScorePercentage ?? "",
        format: (v) => (v === "" ? "—" : `${v}%`),
      },
      {
        key: "avgDelayDays",
        header: "Avg delay (days)",
        isNumeric: true,
        value: (r) => r.avgDelayDays ?? "",
        format: (v) => (v === "" ? "—" : String(v)),
      },
    ],
    chart: {
      kind: "bar",
      category: (r) => r.staffName,
      series: [
        { key: "onTime", label: "On time", value: (r) => r.completedOnTime },
        { key: "late", label: "Late", value: (r) => r.completedLate },
      ],
    },
  };

  // NO custom cell renderer — `ReportView` deliberately renders every column
  // through the SAME `value()`/`format()` pair on screen, PDF and Excel (see
  // `ReportColumn`'s own doc comment: "deliberately separate from
  // `DataTable`'s JSX cell"). A colour-coded badge here would be a fourth
  // thing PDF/Excel cannot reproduce, which is exactly the drift this shell
  // exists to prevent. The colour-coded score lives on the page's `Stat`
  // tile instead (the company-wide figure) — this table is the plain
  // export-safe detail underneath it.
  return (
    <ReportView
      config={config}
      getKey={(r) => r.staffId}
      empty="Nothing assigned to anyone in this month — or nobody's T&A activities are personally claimed yet."
    />
  );
}
