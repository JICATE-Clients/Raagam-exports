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
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { assignTickets } from "@/lib/resolve/actions";
import type { TriageRow } from "@/lib/resolve/types";
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

export type TriageTab = "decide" | "open" | "all";

const TABS: { value: TriageTab; label: string; tooltip: string }[] = [
  { value: "decide", label: "Decide", tooltip: "Unassigned, to sort, to spot-check, or disputed" },
  { value: "open", label: "Open", tooltip: "Every job still owed" },
  { value: "all", label: "All", tooltip: "Every job, closed ones last at score 0" },
];

/** The score, with what earned it — the spec asks for "clear explanations for
 *  each score contribution", so the parts are a tooltip on the number AND the
 *  accessible name, never only a colour. */
function ScoreCell({ row }: { row: TriageRow }) {
  const parts = row.score_parts.filter((p) => p.points);
  const why = parts.length ? parts.map((p) => `${p.label} +${p.points}`).join(" · ") : "Nothing adds to this score";
  return (
    <Tooltip label={why} touch>
      <span className="inline-flex min-w-9 justify-end font-semibold tabular-nums" aria-label={`Score ${row.score}: ${why}`}>
        {row.score}
      </span>
    </Tooltip>
  );
}

/**
 * Triage Queue — Decide · Open · All, highest score first (the RPC orders it;
 * this screen never re-sorts). Tick jobs and "Assign to…" sends them one by one
 * through `assignTickets`, which checks each job on its own and returns the
 * ones it refused — so a batch of ten with two refused says which two and why,
 * instead of failing whole or succeeding silently.
 */
export function TriageScreen({ lists, people }: { lists: Record<TriageTab, TriageRow[]>; people: Person[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [tab, setTab] = useState<TriageTab>("decide");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [assigning, setAssigning] = useState<string[] | null>(null);

  const rows = lists[tab];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.ref_no, r.title, r.place_name, r.trade_name, r.assignee_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      ),
    );
  }, [rows, query]);
  const refOf = useMemo(() => new Map(rows.map((r) => [r.id, r.ref_no])), [rows]);

  function changeTab(next: TriageTab) {
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
      const res = await assignTickets(ids, assigneeId);
      if (!res.ok) {
        error(res.error);
        return;
      }
      const { done, failed } = res.data;
      if (done) success(done === 1 ? "1 job assigned." : `${done} jobs assigned.`);
      for (const f of failed) error(`${refOf.get(f.id) ?? "A job"}: ${f.error}`);
      setAssigning(null);
      setSelected(new Set());
      router.refresh();
    });
  }

  const triageColumns: Column<TriageRow>[] = [
    { header: "Score", align: "right", cell: (r) => <ScoreCell row={r} /> },
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
        menu={[{ label: "Assign", icon: UserPlus, onClick: () => setAssigning([r.id]) }]}
      />
    )),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Triage queue"
          role="tablist"
          value={tab}
          onChange={changeTab}
          options={TABS.map((t) => ({ ...t, count: lists[t.value].length }))}
        />
        <LiveBadge status={live} />
      </div>
      <FilterBar search={query} onSearch={setQuery} searchPlaceholder="Search ref, problem, place, trade or assignee…" />
      <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" onClick={() => setAssigning([...selected])}>
          <UserPlus aria-hidden />
          Assign to…
        </Button>
      </SelectionBar>
      <DataTable
        columns={withCreatedColumns(triageColumns, rows)}
        rows={filtered}
        getKey={(r) => r.id}
        selectable
        selectedKeys={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        empty={rows.length ? "No job matches this search." : tab === "decide" ? "Nothing waiting on a decision." : "No jobs."}
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
