"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useCreatedDateFilter } from "@/lib/masters/use-created-date-filter";
import { fmtDate } from "@/lib/format";
import { dueWords, ticketStatusTone } from "@/lib/resolve/sla";
import { BROKEN_STATUSES, STATUS_LABEL, type TicketListRow } from "@/lib/resolve/types";

export function MyReportsClient({ rows, nowIso }: { rows: TicketListRow[]; nowIso: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const dt = useCreatedDateFilter(rows);
  const nowMs = new Date(nowIso).getTime();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(dt.matches).filter((r) => {
      if (status && r.status !== status) return false;
      if (!q) return true;
      return [r.ref_no, r.title, r.place_name, r.owner_name, r.trade_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, dt.matches, search, status]);

  const columns: Column<TicketListRow>[] = [
    {
      header: "Ref No",
      cell: (r) => (
        <Link href={`/resolve/tickets/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.ref_no}
        </Link>
      ),
    },
    {
      header: "What is wrong",
      cell: (r) => (
        <span className="inline-flex max-w-full items-center gap-1.5">
          {r.is_dangerous ? <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-label="Dangerous" /> : null}
          <Truncated>{r.title}</Truncated>
        </span>
      ),
    },
    { header: "Place", cell: (r) => r.place_name ?? "—" },
    {
      header: "Due",
      cell: (r) => {
        const words = dueWords(r.status, r.due_at, nowMs);
        return (
          <span className="tabular-nums text-xs">
            {r.due_at ? fmtDate(r.due_at) : "—"}
            {words ? (
              <span className={r.is_late ? "block font-medium text-danger" : "block text-muted-foreground"}>{words}</span>
            ) : null}
          </span>
        );
      },
    },
    { header: "Owner", cell: (r) => r.owner_name ?? "—" },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={ticketStatusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
    },
  ];

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-6">
        <p className="text-base font-semibold text-foreground">You haven&apos;t reported anything yet</p>
        <p className="text-sm text-muted-foreground">
          When something is broken — a leak, a light, a machine — report it here and follow it until
          it is fixed.
        </p>
        <Link href="/resolve/report/broken" className={buttonClasses({ variant: "outline" })}>
          Report something broken
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search ref, place, problem…"
        activeCount={(status ? 1 : 0) + dt.active}
        onReset={() => {
          setStatus("");
          dt.reset();
        }}
        dateFilter={dt.bind}
      >
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {BROKEN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <DataTable
        columns={withCreatedColumns(columns, rows)}
        rows={filtered}
        getKey={(r) => r.id}
        onRowHref={(r) => `/resolve/tickets/${r.id}`}
        empty="No reports match these filters."
      />
    </div>
  );
}
