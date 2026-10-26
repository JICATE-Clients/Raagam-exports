"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilterBar } from "@/components/ui/filter-bar";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { assignTickets } from "@/lib/resolve/actions";
import type { TriageRow } from "@/lib/resolve/types";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { AssignSheet, type Person } from "./assign-sheet";
import { ticketClock } from "./queue-clock";
import { AssignButton, QueueList, QueueRow, SelectDock, SelectToggle } from "./queue-rows";
import { ticketHaystack, ticketLine } from "./ticket-columns";

export type TriageTab = "decide" | "open" | "all";

const TABS: { value: TriageTab; label: string; tooltip: string }[] = [
  { value: "decide", label: "Decide", tooltip: "Unassigned, to sort, to spot-check, or disputed" },
  { value: "open", label: "Open", tooltip: "Every job still owed" },
  { value: "all", label: "All", tooltip: "Every job, closed ones last at score 0" },
];

/** Red from 80, amber from 50, green below — the badge's whole colour rule. */
function scoreLook(score: number): string {
  if (score >= 80) return "bg-danger-soft text-danger";
  if (score >= 50) return "bg-warning-soft text-warning";
  return "bg-success-soft text-success";
}

function scoreWhy(row: TriageRow): string {
  const parts = row.score_parts.filter((p) => p.points);
  return parts.length ? parts.map((p) => `${p.label} +${p.points}`).join(" · ") : "Nothing adds to this score";
}

/**
 * A triage row: the round SCORE badge leads, and tapping it opens the line
 * that says what earned it (the spec's "clear explanations for each score
 * contribution") — a tap, not a hover, so a phone can read it too. The number
 * is never the only signal: the explanation is also the badge's accessible name.
 */
function TriageItem({
  row,
  nowMs,
  selecting,
  selected,
  onToggle,
  onAssign,
}: {
  row: TriageRow;
  nowMs: number;
  selecting: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onAssign: () => void;
}) {
  const [why, setWhy] = useState(false);
  const explanation = scoreWhy(row);
  return (
    <QueueRow
      id={row.id}
      lead={
        // button-shape: exempt -- a round score badge that reveals its explanation, not an action button
        <button
          type="button"
          aria-expanded={why}
          aria-label={`Score ${row.score}: ${explanation}`}
          title={explanation}
          onClick={() => setWhy((w) => !w)}
          className={cn(
            "flex size-8 flex-none items-center justify-center rounded-full text-xs font-bold tabular-nums",
            "focus-visible:outline-2 focus-visible:outline-ring",
            scoreLook(row.score),
          )}
        >
          {row.score}
        </button>
      }
      title={row.title}
      dangerous={row.is_dangerous}
      refNo={row.ref_no}
      meta={ticketLine(row)}
      clock={ticketClock(row, nowMs)}
      selecting={selecting}
      selected={selected}
      onToggle={onToggle}
      action={<AssignButton onClick={onAssign} />}
      below={
        why ? (
          <p className="border-t border-dashed border-border bg-surface-muted px-3 py-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Why {row.score}:</span> {explanation}
          </p>
        ) : null
      }
    />
  );
}

/**
 * Triage Queue — Decide · Open · All, highest score first (the RPC orders it;
 * this screen never re-sorts). "Select" turns on tick mode and the docked bar's
 * "Assign to…" sends the ticked jobs one by one through `assignTickets`, which
 * checks each job on its own and returns the ones it refused — so a batch of
 * ten with two refused says which two and why, instead of failing whole or
 * succeeding silently.
 */
export function TriageScreen({
  lists,
  people,
  nowMs,
}: {
  lists: Record<TriageTab, TriageRow[]>;
  people: Person[];
  /** The request time, read by the page (queue-clock.ts says why). */
  nowMs: number;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [tab, setTab] = useState<TriageTab>("decide");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [assigning, setAssigning] = useState<string[] | null>(null);
  useUnsavedGuard(isPending);

  const rows = lists[tab];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => ticketHaystack(r).some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [rows, query]);
  const refOf = useMemo(() => new Map(rows.map((r) => [r.id, r.ref_no])), [rows]);

  function changeTab(next: TriageTab) {
    setTab(next);
    setSelected(new Set());
  }
  function changeSelecting(on: boolean) {
    setSelecting(on);
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
      setSelecting(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ToggleGroup
          label="Triage queue"
          role="tablist"
          value={tab}
          onChange={changeTab}
          className="min-w-0 flex-1 overflow-x-auto"
          options={TABS.map((t) => ({ ...t, count: lists[t.value].length }))}
        />
        <LiveBadge status={live} />
        <SelectToggle on={selecting} onChange={changeSelecting} />
      </div>
      <FilterBar search={query} onSearch={setQuery} searchPlaceholder="Search ref, problem, place, trade or assignee…" />
      <QueueList
        key={tab}
        label="Triage queue"
        rows={filtered}
        getKey={(r) => r.id}
        empty={rows.length ? "No job matches this search." : tab === "decide" ? "Nothing waiting on a decision." : "No jobs."}
        renderRow={(r) => (
          <TriageItem
            row={r}
            nowMs={nowMs}
            selecting={selecting}
            selected={selected.has(r.id)}
            onToggle={toggle}
            onAssign={() => setAssigning([r.id])}
          />
        )}
      />
      {selecting && (
        <SelectDock
          count={selected.size}
          total={filtered.length}
          onAll={() => setSelected(new Set(filtered.map((r) => r.id)))}
          onClear={() => setSelected(new Set())}
          onAssign={() => setAssigning([...selected])}
          disabled={isPending}
        />
      )}
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
