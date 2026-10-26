"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { ToggleGroup } from "@/components/ui/segmented";
import { SelectionBar } from "@/components/ui/selection-bar";
import { useToast } from "@/components/ui/toast";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { AssignSheet, type Person } from "@/components/resolve/work/assign-sheet";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { assignServiceTickets } from "@/lib/resolve/desk-actions";
import {
  DESK_QUEUE_TABS,
  DESK_QUEUE_TAB_LABEL,
  type DeskQueueRow,
  type DeskQueueTab,
  type ShiftSummary,
} from "@/lib/resolve/desk-types";
import {
  deskAssigneeColumn,
  deskPriorityColumn,
  deskRefColumn,
  deskRequesterColumn,
  deskResolutionColumn,
  deskResponseColumn,
  deskStaleColumn,
  deskStatusColumn,
  deskTitleColumn,
  deskTypeColumn,
} from "./desk-columns";

const TAB_TOOLTIP: Record<DeskQueueTab, string> = {
  unassigned: "Nobody is working these yet",
  mine: "Assigned to you, or yours to route",
  team: "Every live request for your teams",
  breaching: "Past an SLA, or 80 % of the way there",
  all: "Every live request in this unit",
  done: "Resolved, closed, cancelled or withdrawn in the last 30 days",
};

const EMPTY: Record<DeskQueueTab, string> = {
  unassigned: "Every request has someone on it.",
  mine: "Nothing is waiting on you.",
  team: "Your teams have no live request.",
  breaching: "Nothing is breaching or at risk.",
  all: "No live request in this unit.",
  done: "Nothing finished in the last 30 days.",
};

/** The Start-of-shift line (spec §7.2) — four numbers, each only when it says something. */
function ShiftLine({ s }: { s: ShiftSummary }) {
  const parts = [
    s.carried_over ? `${s.carried_over} carried over from earlier days` : null,
    s.stale ? `${s.stale} untouched for days` : null,
    s.breaching ? `${s.breaching} breaching or at risk` : null,
    s.new_since_last_shift ? `${s.new_since_last_shift} new since your last shift` : null,
  ].filter(Boolean);
  return (
    <p className="text-sm text-muted-foreground" role="status">
      <span className="font-medium text-foreground">Start of shift:</span>{" "}
      {parts.length ? parts.join(" · ") : "nothing carried over — a clean start."}
    </p>
  );
}

/**
 * Service Desk ▸ Desk Queue (plan §6). Six tabs; every list arrives in QUEUE
 * ORDER from `rh_sd_queue` — overridden first, then priority, then FIFO — and
 * this screen never re-sorts it, because the order IS the rule (spec §3.2).
 *
 * Bulk assign is the triage half: tick rows and "Assign to…" sends them one by
 * one through `assignServiceTickets`, which returns the ones it refused so a batch
 * says which and why. Every other step (claim, start, hold, resolve) lives on
 * the ticket page, where the action list comes from `rh_ticket_actions`.
 *
 * Live: any change to a ticket in this unit refreshes the lists (plan §5).
 */
export function DeskQueueScreen({
  lists,
  shift,
  people,
  canAssign,
}: {
  lists: Record<DeskQueueTab, DeskQueueRow[]>;
  shift: ShiftSummary | null;
  people: Person[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [tab, setTab] = useState<DeskQueueTab>(() => (lists.mine.length || !lists.unassigned.length ? "mine" : "unassigned"));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [assigning, setAssigning] = useState<string[] | null>(null);

  const rows = lists[tab];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.ref_no, r.title, r.category_name, r.team_name, r.reporter_name, r.assignee_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      ),
    );
  }, [rows, query]);
  const refOf = useMemo(() => new Map(DESK_QUEUE_TABS.flatMap((t) => lists[t].map((r) => [r.id, r.ref_no] as const))), [lists]);
  // Done tickets cannot be assigned, so the tab offers no ticks.
  const selectable = canAssign && tab !== "done";

  function changeTab(next: DeskQueueTab) {
    setTab(next);
    setSelected(new Set());
  }
  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id))));
  }

  function assign(ids: string[], assigneeId: string) {
    startTransition(async () => {
      const res = await assignServiceTickets(ids, assigneeId);
      if (!res.ok) {
        error(res.error);
        return;
      }
      const { done, failed } = res.data;
      if (done) success(done === 1 ? "1 request assigned." : `${done} requests assigned.`);
      for (const f of failed) error(`${refOf.get(f.id) ?? "A request"}: ${f.error}`);
      setAssigning(null);
      setSelected(new Set());
      router.refresh();
    });
  }

  const deskQueueColumns: Column<DeskQueueRow>[] = [
    deskRefColumn(),
    deskTypeColumn(),
    deskTitleColumn(),
    deskPriorityColumn(),
    deskRequesterColumn(),
    deskAssigneeColumn(),
    deskResponseColumn(),
    deskResolutionColumn(),
    deskStaleColumn(),
    deskStatusColumn(),
    rowActionsColumn((r) => (
      <RowActions
        label={r.ref_no}
        view={false}
        menu={selectable ? [{ label: "Assign", icon: UserPlus, onClick: () => setAssigning([r.id]) }] : []}
      />
    )),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Desk queue"
          role="tablist"
          value={tab}
          onChange={changeTab}
          options={DESK_QUEUE_TABS.map((t) => ({
            value: t,
            label: DESK_QUEUE_TAB_LABEL[t],
            tooltip: TAB_TOOLTIP[t],
            count: lists[t].length,
          }))}
        />
        <LiveBadge status={live} />
      </div>
      {tab === "mine" && shift && <ShiftLine s={shift} />}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search ref, request, category, team or person…"
      />
      {selectable && (
        <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" onClick={() => setAssigning([...selected])}>
            <UserPlus aria-hidden />
            Assign to…
          </Button>
        </SelectionBar>
      )}
      <DataTable
        columns={withCreatedColumns(deskQueueColumns, rows)}
        rows={filtered}
        getKey={(r) => r.id}
        selectable={selectable}
        selectedKeys={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        empty={rows.length ? "No request matches this search." : EMPTY[tab]}
      />
      <AssignSheet
        key={assigning?.join(",") ?? "none"}
        open={!!assigning}
        count={assigning?.length ?? 0}
        people={people}
        isPending={isPending}
        onClose={() => setAssigning(null)}
        onConfirm={(id) => assigning && assign(assigning, id)}
      />
    </div>
  );
}
