"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/format";
import { toCsv } from "@/lib/resolve/csv";
import type { DeskPerformanceRow } from "@/lib/resolve/desk-types";
import { minutesWords } from "./desk-columns";

const dash = <span className="text-muted-foreground">—</span>;
const isTotal = (r: DeskPerformanceRow) => !r.profile_id;

function mins(v: number | null) {
  return v == null ? dash : <span className="whitespace-nowrap tabular-nums text-sm">{minutesWords(v)}</span>;
}
function pct(v: number | null) {
  return v == null ? dash : <span className="tabular-nums text-sm">{v.toFixed(1)} %</span>;
}
function count(v: number) {
  return <span className="tabular-nums text-sm">{v}</span>;
}

const performanceColumns: Column<DeskPerformanceRow>[] = [
  {
    header: "Technician",
    cell: (r) => <span className={isTotal(r) ? "text-sm font-semibold" : "text-sm"}>{isTotal(r) ? "Desk Total" : r.name}</span>,
  },
  { header: "Resolved", align: "right", cell: (r) => count(r.resolved) },
  { header: "Avg First Response", align: "right", cell: (r) => mins(r.avg_first_response_min) },
  { header: "Avg Resolution", align: "right", cell: (r) => mins(r.avg_resolution_min) },
  { header: "Response Met", align: "right", cell: (r) => pct(r.response_met_pct) },
  { header: "Resolution Met", align: "right", cell: (r) => pct(r.resolution_met_pct) },
  {
    header: "CSAT",
    align: "right",
    cell: (r) =>
      r.csat_avg == null ? (
        dash
      ) : (
        <span className="whitespace-nowrap tabular-nums text-sm">
          {r.csat_avg.toFixed(2)} <span className="text-xs text-muted-foreground">({r.csat_count})</span>
        </span>
      ),
  },
  { header: "Reopened", align: "right", cell: (r) => count(r.reopened) },
  { header: "KB Written", align: "right", cell: (r) => count(r.kb_authored) },
];

/** The CSV carries raw numbers (minutes, percent) so a spreadsheet can sum
 *  and chart them; the screen shows them as words. */
function performanceCsv(rows: DeskPerformanceRow[]): string {
  return toCsv(
    [
      "Technician",
      "Resolved",
      "Avg First Response (min)",
      "Avg Resolution (min)",
      "Response Met %",
      "Resolution Met %",
      "CSAT",
      "CSAT Ratings",
      "Reopened",
      "KB Written",
    ],
    rows.map((r) => [
      isTotal(r) ? "DESK TOTAL" : r.name,
      r.resolved,
      r.avg_first_response_min,
      r.avg_resolution_min,
      r.response_met_pct,
      r.resolution_met_pct,
      r.csat_avg,
      r.csat_count,
      r.reopened,
      r.kb_authored,
    ]),
  );
}

/**
 * Service Desk ▸ Performance (plan §6, spec §6.2) — the "increment
 * evaluations" record: per technician, over the tickets RESOLVED in the range,
 * with the desk total last (`rh_sd_performance`; resolution time excludes
 * paused time). A ticket resolved by nobody in particular counts in the total
 * only, so the rows may sum to less than it.
 *
 * The range lives in the URL (`?from=&to=`), so a month's figures are a link
 * a manager can send; Show is the only thing that navigates, so a date typed
 * a segment at a time does not refetch on every keystroke.
 */
export function DeskPerformanceScreen({ from, to, rows }: { from: string; to: string; rows: DeskPerformanceRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ from, to });
  const changed = draft.from !== from || draft.to !== to;
  const valid = !!draft.from && !!draft.to && draft.from <= draft.to;
  const technicians = rows.filter((r) => !isTotal(r));

  function show() {
    if (!valid) return;
    router.push(`/resolve/desk/performance?from=${draft.from}&to=${draft.to}`);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([performanceCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `desk-performance-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Two 144px dates + the Show button + 2 × 12px gap ≈ 400px → 26rem. */}
        <FieldRow className="max-w-[26rem]">
          <Field label="From" w="code" htmlFor="sd-perf-from">
            <Input id="sd-perf-from" type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          </Field>
          <Field
            label="To"
            w="code"
            htmlFor="sd-perf-to"
            error={draft.from && draft.to && draft.from > draft.to ? "Before From" : undefined}
          >
            <Input id="sd-perf-to" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </Field>
          <Button variant="outline" disabled={!changed || !valid} onClick={show}>
            Show
          </Button>
        </FieldRow>
        <Button variant="outline" disabled={!rows.length} onClick={download}>
          <Download aria-hidden />
          Download CSV
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Requests resolved {fmtDate(from)} – {fmtDate(to)}
        {technicians.length ? ` · ${technicians.length} technician${technicians.length === 1 ? "" : "s"}` : ""}
      </p>
      <DataTable
        columns={withCreatedColumns(performanceColumns, rows)}
        rows={rows}
        getKey={(r) => r.profile_id ?? "total"}
        paginate={false}
        rowClassName={(r) => (isTotal(r) ? "border-t-2 border-border-strong" : undefined)}
        empty="No request was resolved in this range."
      />
    </div>
  );
}
