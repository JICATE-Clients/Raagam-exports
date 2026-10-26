"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Play, UserPlus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { RowActions, type RowMenuItem } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { fmtDateTime } from "@/lib/format";
import { assignComplaint, startComplaint } from "@/lib/resolve/actions";
import { ticketStatusTone } from "@/lib/resolve/sla";
import { STATUS_LABEL, type TicketListRow } from "@/lib/resolve/types";
import { AssignSheet, type Person } from "@/components/resolve/work/assign-sheet";
import { ticketHref } from "@/components/resolve/work/ticket-columns";

export type ComplaintTab = "mine" | "committee" | "all";

const TABS: { value: ComplaintTab; label: string }[] = [
  { value: "mine", label: "Assigned to me" },
  { value: "committee", label: "My committees" },
  { value: "all", label: "All I can see" },
];

const EMPTY: Record<ComplaintTab, string> = {
  mine: "No complaint is waiting on you.",
  committee: "No complaint in a category whose committee you sit on.",
  all: "No complaint you may see.",
};

/** Statuses a handler still owes something on — Start and Assign apply. */
const STARTABLE = new Set(["open", "assigned", "escalated"]);

/*
 * Columns. WHAT IS NOT HERE IS THE POINT: no Reporter column at all. A
 * complaint's reporter is either anonymous (nothing to show) or visible on the
 * ticket page to those allowed; a queue that printed names would put the
 * complainant on every handler's screen. The subject IS shown — the database
 * returned this row only because the viewer may see it (plan §10.3).
 */
const complaintColumns = (actions: (r: TicketListRow) => RowMenuItem[]): Column<TicketListRow>[] => [
  {
    header: "Ref No",
    cell: (r) => (
      <Link href={ticketHref(r.id)} className="font-mono text-xs font-medium text-primary hover:underline">
        {r.ref_no}
      </Link>
    ),
  },
  {
    header: "Category",
    cell: (r) => (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="text-sm">{r.category_name ?? "—"}</span>
        {r.is_sensitive && <StatusPill tone="warning">Sensitive</StatusPill>}
        {r.about_superior && <StatusPill tone="info">About a superior</StatusPill>}
      </span>
    ),
  },
  { header: "Subject", cell: (r) => <Truncated text={r.title} className="block max-w-[20rem] text-sm" /> },
  {
    header: "Respond By",
    cell: (r) => (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="tabular-nums text-xs text-muted-foreground">{fmtDateTime(r.response_due_at ?? r.due_at)}</span>
        {r.is_late && <StatusPill tone="danger">Late</StatusPill>}
      </span>
    ),
  },
  { header: "Handler", cell: (r) => <span className="text-sm">{r.assignee_name ?? r.owner_name ?? "—"}</span> },
  {
    header: "Status",
    cell: (r) => <StatusPill tone={ticketStatusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
  },
  rowActionsColumn((r) => <RowActions label={r.ref_no} view={false} menu={actions(r)} />),
];

/**
 * Resolve Hub ▸ Complaints — the handler's queue. Who sees what is decided in
 * the database (`rh__can_see`): this screen lists exactly what came back and
 * re-derives nothing, so a sensitive complaint can never reach a viewer through
 * a filter written here. Resolve is on the ticket page, because it needs the
 * message the complainant will read.
 */
export function ComplaintsScreen({ lists, people }: { lists: Record<ComplaintTab, TicketListRow[]>; people: Person[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [tab, setTab] = useState<ComplaintTab>(lists.mine.length || !lists.committee.length ? "mine" : "committee");
  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState<TicketListRow | null>(null);

  const rows = lists[tab];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => [r.ref_no, r.title, r.category_name].some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [rows, query]);

  function start(r: TicketListRow) {
    startTransition(async () => {
      const res = await startComplaint(r.id);
      if (res.ok) {
        success(`${r.ref_no} started — the response clock has stopped.`);
        router.refresh();
      } else error(res.error);
    });
  }
  function assign(r: TicketListRow, assigneeId: string) {
    startTransition(async () => {
      const res = await assignComplaint(r.id, assigneeId);
      if (res.ok) {
        success(`${r.ref_no} assigned.`);
        setAssigning(null);
        router.refresh();
      } else error(res.error);
    });
  }

  // Assign needs the people list, which only work / triage / admin may read —
  // `people` arrives empty for anyone else and the icon is simply not offered.
  const actionsFor = (r: TicketListRow): RowMenuItem[] => {
    if (!STARTABLE.has(r.status)) return [];
    const items: RowMenuItem[] = [{ label: "Start", icon: Play, onClick: () => start(r) }];
    if (people.length) items.push({ label: "Assign", icon: UserPlus, onClick: () => setAssigning(r) });
    return items;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Complaints"
          role="tablist"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ ...t, count: lists[t.value].length }))}
        />
        <LiveBadge status={live} />
      </div>
      <FilterBar search={query} onSearch={setQuery} searchPlaceholder="Search ref, subject or category…" />
      <DataTable
        columns={withCreatedColumns(complaintColumns(actionsFor), rows)}
        rows={filtered}
        getKey={(r) => r.id}
        empty={rows.length ? "No complaint matches this search." : EMPTY[tab]}
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
