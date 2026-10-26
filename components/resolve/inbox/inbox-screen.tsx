"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { ROUTE_LOOK } from "@/components/resolve/chat/assist";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { claimTicket } from "@/lib/resolve/actions";
import { claimServiceTicket } from "@/lib/resolve/desk-actions";
import { openInboxTicket } from "@/lib/resolve/inbox-actions";
import {
  INBOX_GROUPS,
  INBOX_GROUP_LABEL,
  INBOX_TABS,
  INBOX_TAB_LABEL,
  type InboxLists,
  type InboxRow,
  type InboxTab,
  type RaiserLists,
} from "@/lib/resolve/inbox-types";
import type { AssistLane } from "@/lib/resolve/assist-types";
import type { TicketDetail } from "@/lib/resolve/types";
import { cn } from "@/lib/utils";
import { Clock, LaneTile } from "./inbox-bits";
import { RaiserPane, ResolverPane } from "./inbox-ticket";

/*
 * RESOLVE INBOX — one workspace, two sides of the same ticket (mockup v4,
 * https://claude.ai/artifact/PPjttWEfrMFJ68AuAc3eBt, "okay do" 2026-10-26).
 *
 *   resolver   /resolve/inbox — every lane in one list: Mine · To take ·
 *              Waiting · Done, grouped by urgency inside each tab.
 *   raiser     /resolve/my-reports — what I raised: "Needs your tap" first.
 *
 * Desktop is two panes (list | ticket); a phone shows one at a time. The list
 * is the server's; the open ticket is fetched on tap (`openInboxTicket`), so
 * opening one never reloads the page. Every change anywhere in the unit
 * refreshes the list live, and the open ticket with it.
 */

type Lane = AssistLane | "all";
const LANES: AssistLane[] = ["fix", "it", "buy", "concern"];

export type InboxScreenProps =
  | { mode: "resolver"; lists: InboxLists; meId: string; initial: TicketDetail | null }
  | { mode: "raiser"; lists: RaiserLists; meId: string; initial: TicketDetail | null };

export function InboxScreen(props: InboxScreenProps) {
  const { mode, meId } = props;
  const router = useRouter();
  const { error, success } = useToast();
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(mode === "resolver" ? (locationId ? { locationId } : null) : { reporterId: meId });
  const [isPending, startTransition] = useTransition();
  const resolverLists = mode === "resolver" ? props.lists : null;
  const raiserLists = mode === "raiser" ? props.lists : null;

  const [tab, setTab] = useState<InboxTab>(() =>
    resolverLists && !resolverLists.mine.length && resolverLists.take.length ? "take" : "mine",
  );
  const [lane, setLane] = useState<Lane>("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<TicketDetail | null>(props.initial);
  const [selected, setSelected] = useState<string | null>(props.initial?.ticket.id ?? null);
  const [paneOpen, setPaneOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  /** The rows of the current view, filtered by lane and search, in sections. */
  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const keep = (r: InboxRow) =>
      (lane === "all" || r.lane === lane) &&
      (!needle || [r.ref_no, r.title, r.sub].some((v) => v.toLowerCase().includes(needle)));
    if (raiserLists) {
      return [
        { key: "turn", label: "Needs your tap", tone: "you" as const, rows: raiserLists.turn.filter(keep) },
        { key: "open", label: "In progress", tone: "plain" as const, rows: raiserLists.open.filter(keep) },
        { key: "done", label: "Finished", tone: "plain" as const, rows: raiserLists.done.filter(keep) },
      ].filter((s) => s.rows.length);
    }
    const rows = (resolverLists as InboxLists)[tab].filter(keep);
    return INBOX_GROUPS.map((g) => ({
      key: g,
      label: INBOX_GROUP_LABEL[g],
      tone: g === "late" ? ("late" as const) : ("plain" as const),
      rows: rows.filter((r) => r.group === g),
    })).filter((s) => s.rows.length);
  }, [raiserLists, resolverLists, tab, lane, query]);
  const flat = sections.flatMap((s) => s.rows);

  // A live refresh brings new LISTS; the open ticket is re-read with them, so
  // the pane never shows a step someone else already took. Skips the first
  // render — the page already sent that ticket.
  const firstLists = useRef(props.lists);
  useEffect(() => {
    if (props.lists === firstLists.current || !selected) return;
    let alive = true;
    openInboxTicket(selected).then((r) => {
      if (alive && r.ok) setDetail(r.data);
    });
    return () => {
      alive = false;
    };
  }, [props.lists, selected]);

  function openTicket(id: string) {
    setSelected(id);
    setPaneOpen(true);
    startTransition(async () => {
      const r = await openInboxTicket(id);
      if (r.ok) setDetail(r.data);
      else error(r.error);
    });
  }
  function reload() {
    router.refresh();
    if (selected) openTicket(selected);
  }
  function take(r: InboxRow) {
    startTransition(async () => {
      const res = r.kind === "service" ? await claimServiceTicket(r.id) : await claimTicket(r.id);
      if (!res.ok) return error(res.error);
      success(`${r.ref_no} is yours.`);
      setTab("mine");
      router.refresh();
      openTicket(r.id);
    });
  }
  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = flat.findIndex((r) => r.id === selected);
    const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    openTicket(next.id);
    listRef.current?.querySelector<HTMLElement>(`[data-row="${next.id}"]`)?.focus();
  }

  const counts = resolverLists
    ? Object.fromEntries(INBOX_TABS.map((t) => [t, resolverLists[t].length]))
    : null;
  const lateMine = resolverLists?.mine.filter((r) => r.group === "late").length ?? 0;

  return (
    <div className="grid h-[calc(100dvh-8.5rem)] min-h-[34rem] overflow-hidden rounded-xl border border-border bg-surface md:grid-cols-[22rem_minmax(0,1fr)]">
      {/* ---- the list ---- */}
      <section
        aria-label={mode === "resolver" ? "Inbox" : "My requests"}
        className={cn("flex min-h-0 min-w-0 flex-col border-border md:border-r", paneOpen && "hidden md:flex")}
      >
        <div className="flex flex-col gap-2 border-b border-border p-2.5">
          {/* The raiser's page header already names the list and carries
              "Report a problem" — the list does not say either twice. */}
          {mode === "resolver" && counts && (
            <ToggleGroup
                label="Inbox"
                role="tablist"
                value={tab}
                onChange={(t) => {
                  setTab(t);
                  const first = (resolverLists as InboxLists)[t][0];
                  if (first) openTicket(first.id);
                }}
                className="min-w-0 flex-1 overflow-x-auto"
                options={INBOX_TABS.map((t) => ({
                  value: t,
                  label: INBOX_TAB_LABEL[t],
                  count: counts[t],
                  after:
                    t === "mine" && lateMine ? (
                      <span className="ml-0.5 rounded-full bg-danger-solid px-1.5 text-[10px] font-bold text-white">
                        {lateMine} late
                      </span>
                    ) : undefined,
                }))}
              />
          )}
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search ref, problem or place"
                className="pl-8"
              />
            </div>
            <ToggleGroup
              label="Lane"
              value={lane}
              onChange={setLane}
              options={[
                { value: "all" as Lane, label: "All" },
                ...LANES.map((l) => ({
                  value: l as Lane,
                  label: <span className="sr-only">{ROUTE_LOOK[l].label}</span>,
                  icon: ROUTE_LOOK[l].icon,
                  iconTone: LANE_ICON_TONE[l],
                  title: `Only ${ROUTE_LOOK[l].label}`,
                })),
              ]}
            />
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onListKey} role="list">
          {sections.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-10 text-center text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">All clear</p>
              <p>
                {query || lane !== "all"
                  ? "Nothing matches this filter."
                  : mode === "raiser"
                    ? "You have not raised anything yet."
                    : EMPTY[tab]}
              </p>
            </div>
          ) : (
            sections.map((s) => (
              <div key={s.key} role="presentation">
                <p
                  className={cn(
                    "sticky top-0 z-[1] flex justify-between border-b border-border bg-surface-muted px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider",
                    s.tone === "late" ? "text-danger" : s.tone === "you" ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <span>{s.label}</span>
                  <span>{s.rows.length}</span>
                </p>
                {s.rows.map((r) => (
                  <div
                    key={r.id}
                    role="listitem"
                    className={cn(
                      "group relative flex items-center border-b border-border",
                      r.id === selected ? "bg-primary-soft" : "hover:bg-surface-muted",
                    )}
                  >
                    {r.id === selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" aria-hidden="true" />}
                    {/* button-shape: exempt -- a whole list row is the tap target, not an action button */}
                    <button
                      type="button"
                      data-row={r.id}
                      onClick={() => openTicket(r.id)}
                      aria-current={r.id === selected ? "true" : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 pr-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <LaneTile lane={r.lane} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-[13px] font-semibold">
                          {r.dangerous && <TriangleAlert className="size-3.5 flex-none text-danger" aria-label="Dangerous" />}
                          <Truncated text={r.title} className="min-w-0" />
                        </span>
                        <span className="flex gap-1 text-[11.5px] text-muted-foreground">
                          <span className="font-mono text-[10.5px]">{r.ref_no}</span>
                          {r.sub && <Truncated text={`· ${r.sub}`} className="min-w-0" />}
                        </span>
                      </span>
                      <span className={cn(mode === "resolver" && tab === "take" && "md:group-hover:hidden")}>
                        {r.yourTurn ? <Clock tone="ok">Your turn</Clock> : <Clock tone={r.clockTone}>{r.clock}</Clock>}
                      </span>
                    </button>
                    {mode === "resolver" && tab === "take" && (
                      <Button
                        size="sm"
                        className="mr-2 flex-none md:hidden md:group-hover:inline-flex"
                        onClick={() => take(r)}
                        disabled={isPending}
                      >
                        Take
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <span className="hidden md:inline">↑ ↓ moves between tickets</span>
          <LiveBadge status={live} />
        </div>
      </section>

      {/* ---- the open ticket ---- */}
      <section aria-label="Ticket" className={cn("min-h-0 min-w-0 flex-col", paneOpen ? "flex" : "hidden md:flex")}>
        {detail ? (
          mode === "resolver" ? (
            <ResolverPane
              key={detail.ticket.id}
              detail={detail}
              meId={meId}
              onBack={() => setPaneOpen(false)}
              onChanged={reload}
            />
          ) : (
            <RaiserPane
              key={detail.ticket.id}
              detail={detail}
              meId={meId}
              onBack={() => setPaneOpen(false)}
              onChanged={reload}
            />
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Pick a ticket</p>
            <p>Its conversation and next step open here.</p>
          </div>
        )}
      </section>
    </div>
  );
}

const EMPTY: Record<InboxTab, string> = {
  mine: "Nothing is waiting on you.",
  take: "No job for your teams is waiting to be taken.",
  wait: "Nothing is on hold.",
  done: "Nothing finished in the last 30 days.",
};

/** The lane icon keeps its colour while its segment is not lit. */
const LANE_ICON_TONE: Record<AssistLane, string> = {
  fix: "text-amber-600 dark:text-amber-400",
  it: "text-sky-600 dark:text-sky-400",
  buy: "text-emerald-600 dark:text-emerald-400",
  concern: "text-violet-600 dark:text-violet-400",
};
