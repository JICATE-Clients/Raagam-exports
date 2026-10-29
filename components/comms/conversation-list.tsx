"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Paperclip, Plus, Search, Star, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { setChatFlags } from "@/lib/comms/actions";
import { messageHref } from "@/lib/comms/search";
import { searchMore } from "@/lib/comms/search-actions";
import type { ConversationSummary, MessageHit } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clockTime, initials } from "./message-body";

type Filter = "all" | "unread" | "favorites" | "groups";
type Flags = { favorite?: boolean; archived?: boolean };

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "favorites", label: "Favourites" },
  { value: "groups", label: "Groups" },
];

const EMPTY: Record<Filter, string> = {
  all: "No chats yet. Tap ＋ to start one.",
  unread: "No unread chats.",
  favorites: "No favourites yet. Point at a chat and tap the star.",
  groups: "No group chats.",
};

/**
 * Pulse — the person's direct and group chats, laid out like WhatsApp (user
 * 2026-10-29: "I want the interface to work just like WhatsApp").
 *
 * - A SEARCH BAR over chats AND messages. Chats are matched here, by name and
 *   last message; messages go to the same `comm_search_messages` the Search
 *   page uses (searchMore), so RLS decides every hit. Debounced, and only the
 *   latest request may land.
 * - ALL · UNREAD · FAVOURITES · GROUPS, a ToggleGroup.
 * - ARCHIVED: a row at the top of All opens the archived chats, each with
 *   Unarchive. Favourite and Archived are the PERSON's own flags (0764), not
 *   the channel archive an admin sets for everyone; an archived chat stays
 *   archived when a new message arrives, as in WhatsApp.
 * - The round ＋ in the bottom-right corner opens New message (?new=1, which
 *   comms-shell.tsx answers with its one sheet).
 *
 * Channels are not repeated here; they have their own fold in the sidebar.
 */
export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showArchived, setShowArchived] = useState(false);
  // Optimistic flags until the refreshed list arrives with the stored ones.
  const [flags, setFlags] = useState<Record<string, Flags>>({});
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [searchingMsgs, setSearchingMsgs] = useState(false);
  const [, start] = useTransition();
  const seq = useRef(0);
  const [now] = useState(() => Date.now());

  const term = q.trim();
  const searching = term.length > 0;

  useEffect(() => {
    const mine = ++seq.current;
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      setSearchingMsgs(true);
      const r = await searchMore({ q: term, sort: "newest" });
      if (mine !== seq.current) return; // a newer keystroke owns the list
      setSearchingMsgs(false);
      setHits(r.ok ? r.hits.slice(0, 20) : []);
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  const chats = conversations
    .filter((c) => c.kind !== "channel")
    .map((c) => ({ ...c, ...flags[c.id] }));
  const active = chats.filter((c) => !c.archived);
  const archived = chats.filter((c) => c.archived);

  const lower = term.toLowerCase();
  const shown = searching
    ? chats.filter((c) => c.title.toLowerCase().includes(lower) || (c.last_body ?? "").toLowerCase().includes(lower))
    : active.filter((c) =>
        filter === "unread" ? c.unread_count > 0 : filter === "favorites" ? c.favorite : filter === "groups" ? c.kind === "group" : true,
      );
  const msgHits = term.length >= 2 ? hits : [];

  function flag(c: ConversationSummary, change: Flags) {
    const before: Flags = { favorite: c.favorite, archived: c.archived };
    setFlags((prev) => ({ ...prev, [c.id]: { ...prev[c.id], ...change } }));
    start(async () => {
      const r = await setChatFlags({ conversation_id: c.id, ...change });
      if (!r.ok) {
        setFlags((prev) => ({ ...prev, [c.id]: before }));
        toast.error(r.error);
        return;
      }
      if (change.archived !== undefined) toast.success(change.archived ? `${c.title} archived` : `${c.title} moved back to Pulse`);
      router.refresh();
    });
  }

  function when(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (days <= 0) return clockTime(iso);
    if (days === 1) return "Yesterday";
    if (days < 7) return d.toLocaleDateString("en-IN", { weekday: "short" });
    return fmtDate(iso);
  }

  if (showArchived) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-2 py-2">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            aria-label="Back to chats"
            className="rounded-control p-2 text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
          <h1 className="text-sm font-semibold text-heading">Archived</h1>
        </header>
        <p className="border-b border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          Archived chats stay here when new messages arrive. Unarchive a chat to move it back to Pulse.
        </p>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Archived chats">
          {archived.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No archived chats.</p>
          ) : (
            <ul className="space-y-0.5">
              {archived.map((c) => (
                <Row key={c.id} c={c} when={when(c.last_message_at ?? c.created_at)} onFlag={(ch) => flag(c, ch)} />
              ))}
            </ul>
          )}
        </nav>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="space-y-2 border-b border-border px-3 py-2">
        <h1 className="text-sm font-semibold text-heading">Pulse</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          {/* caps-input: exempt -- a search box; the query is not a stored value */}
          <Input
            type="search"
            uppercase={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats and messages"
            aria-label="Search chats and messages"
            className="pl-9"
          />
        </div>
        {!searching && <ToggleGroup label="Show chats" value={filter} onChange={setFilter} options={FILTERS} />}
      </header>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2 pb-20" aria-label="Conversations">
        {!searching && filter === "all" && archived.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center text-primary">
              <Archive className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex-1 font-semibold text-foreground">Archived</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{archived.length}</span>
          </button>
        )}

        {searching && <Caption>Chats</Caption>}
        {shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {searching ? `No chats match “${term}”.` : EMPTY[filter]}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {shown.map((c) => (
              <Row key={c.id} c={c} when={when(c.last_message_at ?? c.created_at)} onFlag={(ch) => flag(c, ch)} />
            ))}
          </ul>
        )}

        {term.length >= 2 && (
          <>
            <Caption>Messages</Caption>
            {searchingMsgs && msgHits.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">Searching…</p>
            ) : msgHits.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">No messages match “{term}”.</p>
            ) : (
              <ul className="space-y-0.5">
                {msgHits.map((h) => (
                  <li key={h.message.id}>
                    <Link
                      href={messageHref(h.message)}
                      className="flex flex-col gap-0.5 rounded-md px-2 py-2 text-sm hover:bg-surface-muted"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 break-words font-semibold text-foreground">{h.conversation_title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{when(h.message.created_at)}</span>
                      </span>
                      <Truncated
                        text={`${h.message.author_name ? `${h.message.author_name}: ` : ""}${h.message.body ?? ""}`}
                        className="block text-muted-foreground"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </nav>

      {/* button-shape: exempt -- a round floating action button, WhatsApp's ＋ (user 2026-10-29) */}
      <Link
        href="/comms?new=1"
        aria-label="New chat"
        title="New chat"
        className="absolute bottom-4 right-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Plus className="h-6 w-6" aria-hidden />
      </Link>
    </div>
  );
}

function Caption({ children }: { children: string }) {
  return <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** What a row's second line says: the last message, WhatsApp's way. */
function preview(c: ConversationSummary): string {
  const who = c.kind === "group" && c.last_author_name ? `${c.last_author_name}: ` : c.last_author_name === "You" ? "You: " : "";
  if (c.last_deleted) return `${who}This message was deleted`;
  if (c.last_body) return `${who}${c.last_body}`;
  if (c.last_has_file) return `${who}Attachment`;
  return c.kind === "group" ? `${c.member_count} members` : "No messages yet";
}

/**
 * One chat row: avatar, name, time, last message, the unread / @ badges, and
 * — on hover or keyboard focus — the star and the archive button. The two
 * buttons are siblings of the row's link, never inside it, so a click on
 * them never opens the chat.
 */
function Row({ c, when, onFlag }: { c: ConversationSummary; when: string; onFlag: (change: Flags) => void }) {
  const unread = c.unread_count;
  const mentions = c.mention_count;
  return (
    <li className="group/row relative">
      <Link
        href={`/comms/c/${c.id}`}
        aria-label={`${c.title}${unread ? `, ${unread} unread` : ""}${mentions ? `, ${mentions} mentioning you` : ""}${c.favorite ? ", favourite" : ""}`}
        className={cn(
          "flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          c.muted && "opacity-60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center bg-surface-muted text-xs font-semibold text-muted-foreground",
            c.kind === "group" ? "rounded-lg" : "rounded-full",
          )}
        >
          {c.kind === "group" && !c.name ? <Users className="h-4 w-4" /> : initials(c.title)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 break-words text-foreground", unread > 0 ? "font-bold" : "font-semibold")}>
              {c.title}
            </span>
            <span className={cn("shrink-0 text-xs tabular-nums", unread > 0 ? "font-semibold text-primary" : "text-muted-foreground")}>
              {when}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {c.last_has_file && !c.last_body && !c.last_deleted && (
              <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <Truncated
              text={preview(c)}
              className={cn("min-w-0 flex-1 text-xs text-muted-foreground", c.last_deleted && "italic")}
            />
            {c.favorite && <Star className="h-3 w-3 shrink-0 fill-warning text-warning" aria-hidden />}
            {mentions > 0 && (
              <span className="shrink-0 rounded-full bg-warning-soft px-1.5 text-[11px] font-bold text-warning" aria-hidden>
                @
              </span>
            )}
            {unread > 0 && !c.muted && (
              <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums" aria-hidden>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
        </span>
      </Link>
      <div className="absolute right-2 top-1.5 flex gap-0.5 rounded-control bg-surface-muted opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        <button
          type="button"
          onClick={() => onFlag({ favorite: !c.favorite })}
          aria-label={c.favorite ? `Remove ${c.title} from favourites` : `Add ${c.title} to favourites`}
          title={c.favorite ? "Remove from favourites" : "Add to favourites"}
          className="rounded-control p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star className={cn("h-3.5 w-3.5", c.favorite && "fill-warning text-warning")} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onFlag({ archived: !c.archived })}
          aria-label={c.archived ? `Unarchive ${c.title}` : `Archive ${c.title}`}
          title={c.archived ? "Unarchive" : "Archive"}
          className="rounded-control p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {c.archived ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>
    </li>
  );
}
