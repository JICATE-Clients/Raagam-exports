"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, CirclePause, CirclePlay, Hand, Play } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { RowActions, type RowMenuItem } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { blockTicket, claimTicket, startTicket, unblockTicket } from "@/lib/resolve/actions";
import type { TicketListRow } from "@/lib/resolve/types";
import { ReasonSheet } from "./reason-sheet";
import {
  dueColumn,
  placeColumn,
  refColumn,
  statusColumn,
  ticketHref,
  titleColumn,
  tradeColumn,
} from "./ticket-columns";

export type MyWorkTab = "assigned" | "in_progress" | "to_claim" | "done";

const TABS: { value: MyWorkTab; label: string }[] = [
  { value: "assigned", label: "Assigned to me" },
  { value: "in_progress", label: "In progress" },
  { value: "to_claim", label: "To claim" },
  { value: "done", label: "Done" },
];

const EMPTY: Record<MyWorkTab, string> = {
  assigned: "Nothing is assigned to you.",
  in_progress: "You have no job in progress.",
  to_claim: "No unclaimed job for your teams.",
  done: "Nothing fixed by you yet.",
};

/**
 * My Work — the worker's four queues (spec §9). Every row action is the
 * ticket's next step for a worker; the server re-checks each one
 * (`rh_claim` / `rh_start` / `rh_block` / `rh_unblock`), so a stale tab that
 * offers Start on a job someone else already started gets a sentence, not a
 * second start. Fix lives on the ticket page, because it needs the photo.
 */
export function MyWorkScreen({ lists }: { lists: Record<MyWorkTab, TicketListRow[]> }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [tab, setTab] = useState<MyWorkTab>(lists.assigned.length || !lists.to_claim.length ? "assigned" : "to_claim");
  const [query, setQuery] = useState("");
  const [blocking, setBlocking] = useState<TicketListRow | null>(null);

  const rows = lists[tab];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.ref_no, r.title, r.place_name, r.trade_name].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        success(done);
        after?.();
        router.refresh();
      } else error(res.error);
    });
  }

  // Inline icons, never a ⋮ (AGENTS "Row actions"): each is the job's next
  // step for a worker. Fix opens the ticket, where the photo is captured.
  const actionsFor = (r: TicketListRow): RowMenuItem[] => {
    const name = r.ref_no;
    const items: RowMenuItem[] = [];
    if (tab === "to_claim") {
      items.push({ label: "Claim", icon: Hand, onClick: () => run(() => claimTicket(r.id), `${name} is yours.`) });
      return items;
    }
    if (r.status === "open") {
      items.push({ label: "Start", icon: Play, onClick: () => run(() => startTicket(r.id), `${name} started.`) });
    }
    if (r.status === "open" || r.status === "in_progress") {
      items.push({ label: "Block", icon: CirclePause, onClick: () => setBlocking(r) });
    }
    if (r.status === "blocked") {
      items.push({ label: "Unblock", icon: CirclePlay, onClick: () => run(() => unblockTicket(r.id), `${name} resumed.`) });
    }
    if (r.status === "in_progress") {
      items.push({ label: "Fix with photo", icon: Camera, onClick: () => router.push(ticketHref(r.id)) });
    }
    return items;
  };

  const workColumns: Column<TicketListRow>[] = [
    refColumn(),
    titleColumn(),
    placeColumn(),
    tradeColumn(),
    dueColumn(),
    statusColumn(),
    rowActionsColumn((r) => <RowActions label={r.ref_no} view={false} menu={actionsFor(r)} />),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="My work"
          role="tablist"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ ...t, count: lists[t.value].length }))}
        />
        <LiveBadge status={live} />
      </div>
      <FilterBar search={query} onSearch={setQuery} searchPlaceholder="Search ref, problem, place or trade…" />
      <DataTable
        columns={withCreatedColumns(workColumns, rows)}
        rows={filtered}
        getKey={(r) => r.id}
        empty={rows.length ? "No job matches this search." : EMPTY[tab]}
      />
      <ReasonSheet
        key={blocking?.id ?? "none"}
        open={!!blocking}
        title={blocking ? `Block ${blocking.ref_no}` : "Block"}
        label="Why is it blocked?"
        confirmLabel="Block job"
        isPending={isPending}
        onClose={() => setBlocking(null)}
        onConfirm={(reason) => {
          const t = blocking;
          if (t) run(() => blockTicket(t.id, reason), `${t.ref_no} blocked — the clock is paused.`, () => setBlocking(null));
        }}
      />
    </div>
  );
}
