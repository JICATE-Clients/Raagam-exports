"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDot, Download, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { useFacetFilter, createdDateFacet, createdByFacet, type FacetGroup } from "@/components/ui/filter-drawer";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { Stat } from "@/components/ui/stat";
import { useToast } from "@/components/ui/toast";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { assignTickets, exportJobsCsv } from "@/lib/resolve/actions";
import { BROKEN_STATUSES, STATUS_LABEL, type BrokenStatus, type TicketListRow } from "@/lib/resolve/types";
import { AssignSheet, type Person } from "./assign-sheet";
import {
  assigneeColumn,
  dueColumn,
  placeColumn,
  refColumn,
  statusColumn,
  titleColumn,
  tradeColumn,
} from "./ticket-columns";

export type JobCounts = { open: number; late: number; waiting: number; completed30: number };

/**
 * All Jobs — every broken ticket in the current unit, in entry order. The four
 * tiles are the server's counts over the WHOLE unit (not the filtered rows), so
 * a filter never makes "Late" look smaller than it is. CSV export runs on the
 * server with the same three filters, so the file says what the screen says.
 */
export function JobsScreen({
  rows,
  counts,
  trades,
  people,
  canAssign,
  canExport,
}: {
  rows: TicketListRow[];
  counts: JobCounts;
  trades: { id: string; name: string }[];
  people: Person[];
  canAssign: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState<TicketListRow | null>(null);

  const groups = useMemo<FacetGroup<TicketListRow>[]>(
    () => [
      {
        title: "Job",
        icon: <CircleDot />,
        facets: [
          {
            key: "status",
            label: "Status",
            options: BROKEN_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            match: (r, v) => r.status === v,
            counted: true,
          },
          {
            key: "trade",
            label: "Trade",
            all: "All trades",
            options: trades.map((t) => ({ value: t.id, label: t.name })),
            match: (r, v) => r.trade_id === v,
          },
          {
            key: "overdue",
            label: "Overdue",
            all: "Any",
            options: [{ value: "yes", label: "Late only" }],
            match: (r) => r.is_late,
          },
        ],
      },
      { title: "Created", facets: [createdDateFacet(), createdByFacet()] },
    ],
    [trades],
  );
  const facets = useFacetFilter(rows, groups);
  const matchesFacets = facets.matches;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchesFacets(r)) return false;
      if (!needle) return true;
      return [r.ref_no, r.title, r.place_name, r.trade_name, r.assignee_name, r.owner_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [rows, query, matchesFacets]);

  function exportCsv() {
    const v = facets.values;
    startTransition(async () => {
      const res = await exportJobsCsv({
        status: (v.status || undefined) as BrokenStatus | undefined,
        trade_id: v.trade || undefined,
        overdue: v.overdue === "yes" || undefined,
      });
      if (!res.ok) {
        error(res.error);
        return;
      }
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "resolve-jobs.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function assign(t: TicketListRow, assigneeId: string) {
    startTransition(async () => {
      const res = await assignTickets([t.id], assigneeId);
      if (!res.ok) {
        error(res.error);
        return;
      }
      const refused = res.data.failed[0];
      if (refused) error(`${t.ref_no}: ${refused.error}`);
      else success(`${t.ref_no} assigned.`);
      setAssigning(null);
      router.refresh();
    });
  }

  const jobColumns: Column<TicketListRow>[] = [
    refColumn(),
    titleColumn(),
    placeColumn(),
    tradeColumn(),
    assigneeColumn(),
    dueColumn(),
    statusColumn(),
    rowActionsColumn((r) => (
      <RowActions
        label={r.ref_no}
        view={false}
        menu={canAssign ? [{ label: "Assign", icon: UserPlus, onClick: () => setAssigning(r) }] : []}
      />
    )),
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <LiveBadge status={live} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open" value={counts.open} hint="Still owed — open, in progress, blocked or awaiting a check" />
        <Stat label="Late" value={counts.late} tone={counts.late ? "danger" : "neutral"} hint="Past due while open or in progress" />
        <Stat label="Waiting" value={counts.waiting} tone={counts.waiting ? "warning" : "neutral"} hint="Blocked — the clock is paused" />
        <Stat label="Completed (30 days)" value={counts.completed30} tone="success" hint="Closed in the last 30 days" />
      </div>
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search ref, problem, place, trade or person…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        trailing={
          canExport ? (
            <Button variant="outline" disabled={isPending} onClick={exportCsv}>
              <Download aria-hidden />
              Export CSV
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={withCreatedColumns(jobColumns, rows)}
        rows={filtered}
        getKey={(r) => r.id}
        empty={rows.length ? "No job matches these filters." : "No jobs reported in this unit yet."}
      />
      <AssignSheet
        key={assigning?.id ?? "none"}
        open={!!assigning}
        count={1}
        people={people}
        isPending={isPending}
        onClose={() => setAssigning(null)}
        onConfirm={(id) => assigning && assign(assigning, id)}
      />
    </div>
  );
}
