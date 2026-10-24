"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useCreatedDateFilter } from "@/lib/masters/use-created-date-filter";
import { fmtDateTime } from "@/lib/format";
import { spanWords, ticketStatusTone } from "@/lib/resolve/sla";
import { COMPLAINT_STATUSES, COMPLAINT_STATUS_LABEL, type ComplaintStatus, type TicketListRow } from "@/lib/resolve/types";

/** Response-deadline words: only while nobody has answered yet. */
function responseWords(r: TicketListRow, nowMs: number): { text: string; late: boolean } | null {
  if (!r.response_due_at || (r.status !== "open" && r.status !== "assigned" && r.status !== "escalated")) return null;
  const diff = new Date(r.response_due_at).getTime() - nowMs;
  return diff >= 0
    ? { text: `Reply due in ${spanWords(diff)}`, late: false }
    : { text: `Reply ${spanWords(diff)} late`, late: true };
}

export function MyComplaintsClient({ rows, nowIso }: { rows: TicketListRow[]; nowIso: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const dt = useCreatedDateFilter(rows);
  const nowMs = new Date(nowIso).getTime();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(dt.matches).filter((r) => {
      if (status && r.status !== status) return false;
      if (!q) return true;
      return [r.ref_no, r.title, r.category_name, r.owner_name]
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
    { header: "Subject", cell: (r) => <Truncated>{r.title}</Truncated> },
    { header: "Category", cell: (r) => r.category_name ?? "—" },
    { header: "Handler", cell: (r) => r.owner_name ?? "—" },
    {
      header: "Response",
      cell: (r) => {
        const w = responseWords(r, nowMs);
        return (
          <span className="tabular-nums text-xs">
            {r.response_due_at ? fmtDateTime(r.response_due_at) : "—"}
            {w ? <span className={w.late ? "block font-medium text-danger" : "block text-muted-foreground"}>{w.text}</span> : null}
          </span>
        );
      },
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={ticketStatusTone(r.status)}>
          {COMPLAINT_STATUS_LABEL[r.status as ComplaintStatus] ?? r.status}
        </StatusPill>
      ),
    },
  ];

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-6">
        <p className="text-base font-semibold text-foreground">You haven&apos;t made a complaint</p>
        <p className="text-sm text-muted-foreground">
          Complaints you send with your name appear here. Anonymous ones never do — follow those with
          the private link you were given.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/p/track" className="text-primary underline-offset-2 hover:underline">
            Track an anonymous complaint
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search ref, subject, category…"
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
            {COMPLAINT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {COMPLAINT_STATUS_LABEL[s]}
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
        empty="No complaints match these filters."
      />
      <p className="text-xs text-muted-foreground">
        Anonymous complaints are not listed —{" "}
        <Link href="/p/track" className="text-primary underline-offset-2 hover:underline">
          track one with its private link
        </Link>
        .
      </p>
    </div>
  );
}
