"use client";

import { useMemo, useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  NEEDED_BY_LABEL,
  RQ_REASON_LABEL,
  RQ_STATUS_LABEL,
  type NeededBy,
  type RqReason,
} from "@/lib/resolve/assist-types";
import { requirementStatusTone } from "@/lib/resolve/sla";
import type { RequirementStatus, TicketListRow } from "@/lib/resolve/types";
import { refColumn, ticketHref } from "./ticket-columns";

export type RequirementTab = "pending" | "approved" | "done";

const TABS: { value: RequirementTab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "done", label: "Done" },
];

const EMPTY: Record<RequirementTab, string> = {
  pending: "Nothing is waiting for a decision.",
  approved: "Nothing approved is waiting to be given.",
  done: "Nothing was given, rejected or withdrawn in the last 30 days.",
};

/**
 * Requirements — the Stores queue for Raagam Assist's Buy requests (0751).
 * Read-only on purpose: Approve / Reject / Mark as given live on the ticket
 * page, where `rh_ticket_actions` decides which of them this person may do —
 * a row icon here would have to guess that. The ref opens the request.
 *
 * Created User IS the person who asked (the request is created as them), so
 * it is the "Asked by" column rather than a second copy of it.
 */
export function RequirementsScreen({ lists }: { lists: Record<RequirementTab, TicketListRow[]> }) {
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [tab, setTab] = useState<RequirementTab>(lists.pending.length || !lists.approved.length ? "pending" : "approved");
  const [query, setQuery] = useState("");

  const rows = lists[tab];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.ref_no, r.title, r.reporter_name, r.description].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  const requirementColumns: Column<TicketListRow>[] = [
    refColumn(),
    {
      header: "Item",
      cell: (r) => <Truncated text={r.title} className="block max-w-[18rem] text-sm" />,
    },
    {
      header: "Qty",
      align: "right",
      className: HUG,
      cell: (r) => <span className="tabular-nums text-sm">{r.rq_qty != null ? fmtNumber(Number(r.rq_qty)) : "—"}</span>,
    },
    {
      header: "Needed By",
      className: HUG,
      cell: (r) => (
        <span className="text-sm">
          {r.rq_needed_by ? NEEDED_BY_LABEL[r.rq_needed_by as NeededBy] : "—"}
          {r.due_at && r.status === "open" ? (
            <span className="block text-xs tabular-nums text-muted-foreground">By {fmtDate(r.due_at)}</span>
          ) : null}
        </span>
      ),
    },
    {
      header: "Why",
      className: HUG,
      cell: (r) => <span className="text-sm">{r.rq_reason ? RQ_REASON_LABEL[r.rq_reason as RqReason] : "—"}</span>,
    },
    {
      header: "Status",
      className: HUG,
      cell: (r) => (
        <StatusPill tone={requirementStatusTone(r.status)}>
          {RQ_STATUS_LABEL[r.status as RequirementStatus] ?? r.status}
        </StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Requirements"
          role="tablist"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ ...t, count: lists[t.value].length }))}
        />
        <LiveBadge status={live} />
      </div>
      <FilterBar search={query} onSearch={setQuery} searchPlaceholder="Search ref, item or who asked…" />
      <DataTable
        columns={hugCreated(withCreatedColumns(requirementColumns, rows))}
        rows={filtered}
        getKey={(r) => r.id}
        onRowHref={(r) => ticketHref(r.id)}
        empty={rows.length ? "No request matches this search." : EMPTY[tab]}
      />
    </div>
  );
}
