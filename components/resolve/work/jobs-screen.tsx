"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDot, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { useFacetFilter, createdDateFacet, createdByFacet, type FacetGroup } from "@/components/ui/filter-drawer";
import { PageHeader } from "@/components/ui/page-header";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { LaneTile } from "@/components/resolve/inbox/inbox-bits";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { assignTickets, exportJobsCsv } from "@/lib/resolve/actions";
import {
  ACTIVE_STATUSES,
  BROKEN_STATUSES,
  STATUS_LABEL,
  type BrokenStatus,
  type TicketListRow,
} from "@/lib/resolve/types";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { AssignSheet, type Person } from "./assign-sheet";
import { ticketClock } from "./queue-clock";
import { AssignButton, QueueList, QueueRow } from "./queue-rows";
import { ticketHaystack, ticketLine } from "./ticket-columns";

export type JobCounts = { open: number; late: number; waiting: number; completed30: number };

type Bucket = "open" | "late" | "waiting" | "done";
const DAY_MS = 86_400_000;

/**
 * All Jobs — every broken ticket in the current unit, in entry order.
 *
 * The four status chips (Open · Late · Waiting · Done) carry the server's
 * counts over the WHOLE unit (not the filtered rows), so a filter never makes
 * "Late" look smaller than it is; tapping one narrows the list to it, tapping
 * it again lets go. Search and Filters share one row, and every facet set shows
 * as a chip with its own ✕. CSV export stays in the header and runs on the
 * server with the same filters, so the file says what the screen says.
 */
export function JobsScreen({
  rows,
  counts,
  trades,
  people,
  canAssign,
  canExport,
  nowMs,
}: {
  rows: TicketListRow[];
  counts: JobCounts;
  trades: { id: string; name: string }[];
  people: Person[];
  canAssign: boolean;
  canExport: boolean;
  /** The request time, read by the page (queue-clock.ts says why). */
  nowMs: number;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [assigning, setAssigning] = useState<TicketListRow | null>(null);
  useUnsavedGuard(isPending);

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
    const since30 = nowMs - 30 * DAY_MS;
    const inBucket = (r: TicketListRow) => {
      switch (bucket) {
        case "open":
          return (ACTIVE_STATUSES as readonly string[]).includes(r.status);
        case "late":
          return r.is_late;
        case "waiting":
          return r.status === "blocked";
        case "done":
          return r.status === "closed" && !!r.closed_at && new Date(r.closed_at).getTime() >= since30;
        default:
          return true;
      }
    };
    return rows.filter((r) => {
      if (!inBucket(r) || !matchesFacets(r)) return false;
      if (!needle) return true;
      return ticketHaystack(r).some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [rows, query, matchesFacets, bucket, nowMs]);

  /** Each facet that is set, worded for its removable chip. */
  const activeChips = groups
    .flatMap((g) => g.facets)
    .flatMap((f) => {
      const v = facets.values[f.key];
      if (!v) return [];
      const word = f.options?.find((o) => o.value === v)?.label ?? v;
      return [{ key: f.key, text: f.key === "overdue" ? word : `${f.label}: ${word}` }];
    });

  function exportCsv() {
    const v = facets.values;
    startTransition(async () => {
      const res = await exportJobsCsv({
        status: (v.status || (bucket === "waiting" ? "blocked" : undefined)) as BrokenStatus | undefined,
        trade_id: v.trade || undefined,
        overdue: v.overdue === "yes" || bucket === "late" || undefined,
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

  return (
    <div className="space-y-3">
      <PageHeader
        title="All Jobs"
        description="Every broken report in this unit, oldest first"
        actions={
          canExport ? (
            <Button variant="outline" disabled={isPending} onClick={exportCsv}>
              <Download aria-hidden />
              Export CSV
            </Button>
          ) : undefined
        }
      />
      <div className="flex items-center gap-2">
        <ToggleGroup
          label="Job status"
          value={bucket}
          onChange={(b) => setBucket((cur) => (cur === b ? null : b))}
          className="min-w-0 flex-1 overflow-x-auto"
          options={[
            { value: "open" as Bucket, label: "Open", count: counts.open, tooltip: "Still owed — open, in progress, blocked or awaiting a check" },
            {
              value: "late" as Bucket,
              label: "Late",
              tooltip: "Past due while open or in progress",
              after: counts.late ? (
                <span className="ml-0.5 rounded-full bg-danger-solid px-1.5 text-[10px] font-bold text-white">{counts.late}</span>
              ) : (
                <span className="tabular-nums opacity-80">(0)</span>
              ),
            },
            { value: "waiting" as Bucket, label: "Waiting", count: counts.waiting, tooltip: "Blocked — the clock is paused" },
            { value: "done" as Bucket, label: "Done", count: counts.completed30, tooltip: "Closed in the last 30 days" },
          ]}
        />
        <LiveBadge status={live} />
      </div>
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search ref, problem, place, trade or person…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
      />
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map((c) => (
            <Button key={c.key} size="sm" variant="outline" onClick={() => facets.set(c.key, "")} aria-label={`Remove filter ${c.text}`}>
              {c.text}
              <X aria-hidden />
            </Button>
          ))}
        </div>
      )}
      <QueueList
        label="All jobs"
        rows={filtered}
        getKey={(r) => r.id}
        empty={rows.length ? "No job matches these filters." : "No jobs reported in this unit yet."}
        renderRow={(r) => (
          <QueueRow
            id={r.id}
            lead={<LaneTile lane="fix" />}
            title={r.title}
            dangerous={r.is_dangerous}
            refNo={r.ref_no}
            meta={ticketLine(r)}
            clock={ticketClock(r, nowMs)}
            action={canAssign ? <AssignButton onClick={() => setAssigning(r)} /> : undefined}
          />
        )}
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
