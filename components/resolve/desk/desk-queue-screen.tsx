"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { ToggleGroup } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { LaneTile } from "@/components/resolve/inbox/inbox-bits";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { AssignSheet, type Person } from "@/components/resolve/work/assign-sheet";
import { deskClock } from "@/components/resolve/work/queue-clock";
import { AssignButton, QueueList, QueueRow, SelectDock, SelectToggle } from "@/components/resolve/work/queue-rows";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { assignServiceTickets } from "@/lib/resolve/desk-actions";
import {
  DESK_QUEUE_TABS,
  DESK_QUEUE_TAB_LABEL,
  type DeskQueueRow,
  type DeskQueueTab,
  type ShiftSummary,
} from "@/lib/resolve/desk-types";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { deskHaystack, deskLine, overrideWords, priorityStripe } from "./desk-columns";

/** The four chips on the row; Team and All sit behind Filters (mockup, approved). */
const CHIP_TABS = ["unassigned", "mine", "breaching", "done"] as const satisfies readonly DeskQueueTab[];
const MORE_TABS = ["team", "all"] as const satisfies readonly DeskQueueTab[];

/** "To hand out" is the floor's word for a request nobody holds yet. */
const CHIP_LABEL: Record<DeskQueueTab, string> = { ...DESK_QUEUE_TAB_LABEL, unassigned: "To hand out" };

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

/** The Start-of-shift line (spec §7.2) — four numbers, each only when it says
 *  something — as an amber banner the operator can put away for the visit. */
function ShiftBanner({ s, onDismiss }: { s: ShiftSummary; onDismiss: () => void }) {
  const parts = [
    s.carried_over ? `${s.carried_over} carried over` : null,
    s.stale ? `${s.stale} untouched for days` : null,
    s.breaching ? `${s.breaching} breaching or at risk` : null,
    s.new_since_last_shift ? `${s.new_since_last_shift} new since your last shift` : null,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-warning-soft py-1.5 pl-3 pr-1.5 text-sm" role="status">
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Start of shift:</span>{" "}
        {parts.length ? parts.join(" · ") : "nothing carried over — a clean start."}
      </p>
      <Button size="icon" variant="ghost" onClick={onDismiss} aria-label="Dismiss start of shift">
        <X aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Service Desk ▸ Desk Queue (plan §6). Every list arrives in QUEUE ORDER from
 * `rh_sd_queue` — overridden first, then priority, then FIFO — and this screen
 * never re-sorts it, because the order IS the rule (spec §3.2).
 *
 * One row per request (mobile redesign, 2026-10-26): IT tile · title (⚡ when
 * overridden) · requester · priority · assignee · ONE clock, with priority as
 * the left stripe. Four chips — To hand out · Mine · Breaching · Done; Team and
 * All are behind Filters. Tapping a row opens it in the Inbox.
 *
 * Bulk assign is the triage half: "Select" turns on tick mode and the docked
 * bar's "Assign to…" sends them one by one through `assignServiceTickets`,
 * which returns the ones it refused so a batch says which and why.
 *
 * Live: any change to a ticket in this unit refreshes the lists (plan §5).
 */
export function DeskQueueScreen({
  lists,
  shift,
  people,
  canAssign,
  nowMs,
}: {
  lists: Record<DeskQueueTab, DeskQueueRow[]>;
  shift: ShiftSummary | null;
  people: Person[];
  canAssign: boolean;
  /** The request time, read by the page (queue-clock.ts says why). */
  nowMs: number;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [tab, setTab] = useState<DeskQueueTab>(() => (lists.mine.length || !lists.unassigned.length ? "mine" : "unassigned"));
  const [query, setQuery] = useState("");
  const [shiftShown, setShiftShown] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [assigning, setAssigning] = useState<string[] | null>(null);
  useUnsavedGuard(isPending);

  const rows = lists[tab];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => deskHaystack(r).some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [rows, query]);
  const refOf = useMemo(() => new Map(DESK_QUEUE_TABS.flatMap((t) => lists[t].map((r) => [r.id, r.ref_no] as const))), [lists]);
  // Done tickets cannot be assigned, so that tab offers no ticks and no Assign.
  const assignable = canAssign && tab !== "done";
  const ticking = selecting && assignable;
  const moreTab = (MORE_TABS as readonly DeskQueueTab[]).includes(tab);

  function changeTab(next: DeskQueueTab) {
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
      setSelecting(false);
      router.refresh();
    });
  }

  const breaching = lists.breaching.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ToggleGroup
          label="Desk queue"
          role="tablist"
          value={moreTab ? null : tab}
          onChange={changeTab}
          className="min-w-0 flex-1 overflow-x-auto"
          options={CHIP_TABS.map((t) => ({
            value: t,
            label: CHIP_LABEL[t],
            tooltip: TAB_TOOLTIP[t],
            count: t === "breaching" ? undefined : lists[t].length,
            after:
              t === "breaching" ? (
                <span
                  className={
                    breaching
                      ? "ml-0.5 rounded-full bg-danger-solid px-1.5 text-[10px] font-bold text-white"
                      : "tabular-nums opacity-80"
                  }
                >
                  {breaching ? breaching : "(0)"}
                </span>
              ) : undefined,
          }))}
        />
        <LiveBadge status={live} />
        {assignable && <SelectToggle on={selecting} onChange={changeSelecting} />}
      </div>
      {shift && shiftShown && <ShiftBanner s={shift} onDismiss={() => setShiftShown(false)} />}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search ref, request, category, team or person…"
        activeCount={moreTab ? 1 : 0}
        onReset={moreTab ? () => changeTab("mine") : undefined}
        panel={
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
            <span className="text-xs font-semibold text-muted-foreground">Show</span>
            <ToggleGroup
              label="Wider lists"
              role="tablist"
              value={moreTab ? tab : null}
              onChange={changeTab}
              options={MORE_TABS.map((t) => ({
                value: t,
                label: CHIP_LABEL[t],
                tooltip: TAB_TOOLTIP[t],
                count: lists[t].length,
              }))}
            />
          </div>
        }
      />
      {moreTab && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => changeTab("mine")} aria-label={`Remove filter ${CHIP_LABEL[tab]}`}>
            {CHIP_LABEL[tab]}
            <X aria-hidden />
          </Button>
        </div>
      )}
      <QueueList
        key={tab}
        label="Desk queue"
        rows={filtered}
        getKey={(r) => r.id}
        empty={rows.length ? "No request matches this search." : EMPTY[tab]}
        renderRow={(r) => (
          <QueueRow
            id={r.id}
            lead={<LaneTile lane="it" />}
            stripe={priorityStripe(r.priority)}
            title={r.title}
            titleIcon={
              r.overridden ? (
                <Tooltip label={overrideWords(r)}>
                  <Zap className="size-3.5 flex-none text-danger" aria-label={overrideWords(r)} />
                </Tooltip>
              ) : undefined
            }
            refNo={r.ref_no}
            meta={deskLine(r)}
            clock={deskClock(r, nowMs)}
            selecting={ticking}
            selected={selected.has(r.id)}
            onToggle={toggle}
            action={assignable ? <AssignButton onClick={() => setAssigning([r.id])} /> : undefined}
          />
        )}
      />
      {ticking && (
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
