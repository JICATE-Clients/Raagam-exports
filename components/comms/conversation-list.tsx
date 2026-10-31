"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Compass,
  Hash,
  Loader2,
  Lock,
  MessageCircle,
  Plus,
  Search,
  Star,
  Users,
  X,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { setChatFlags } from "@/lib/comms/actions";
import { messageHref } from "@/lib/comms/search";
import { searchMore } from "@/lib/comms/search-actions";
import type { ConversationSummary, MessageHit } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { glowVars } from "@/lib/ui/buyer-glow";
import { cn } from "@/lib/utils";
import { clockTime, initials } from "./message-body";

type Filter = "all" | "unread" | "favorites" | "groups";
type Flags = { favorite?: boolean; archived?: boolean };

/**
 * Each filter wears its own colour (the Pulse redesign, 2026-10-29): a dot,
 * and when chosen a tinted pill with a solid count. Static literals so
 * Tailwind sees them. The coral is darkened from the mock-up's #f0705a to
 * #c94a32 wherever it carries white text, so the count still reads at 4.5:1.
 */
const FILTERS: { value: Filter; label: string; dot: string; on: string; count: string }[] = [
  {
    value: "all",
    label: "All",
    dot: "bg-primary",
    on: "border-primary bg-primary-soft text-primary",
    count: "bg-primary text-primary-foreground",
  },
  {
    value: "unread",
    label: "Unread",
    dot: "bg-[#f0705a]",
    on: "border-[#c94a32] bg-[color-mix(in_srgb,#f0705a_14%,var(--surface))] text-[#c94a32] dark:text-[#ff9a85]",
    count: "bg-[#c94a32] text-white",
  },
  {
    value: "favorites",
    label: "Favourites",
    dot: "bg-[#e0961c]",
    on: "border-[#b7791f] bg-[color-mix(in_srgb,#e0961c_16%,var(--surface))] text-[#8a5a0b] dark:text-[#f2c06b]",
    count: "bg-[#8a5a0b] text-white",
  },
  {
    value: "groups",
    label: "Groups",
    dot: "bg-[#6c5ce7]",
    on: "border-[#6c5ce7] bg-[color-mix(in_srgb,#6c5ce7_14%,var(--surface))] text-[#5b4bd6] dark:text-[#b4a9ff]",
    count: "bg-[#5b4bd6] text-white",
  },
];

const EMPTY: Record<Filter, [string, string]> = {
  all: ["No chats yet", "Start one with New chat."],
  unread: ["You are all caught up", "New messages will show up here."],
  favorites: ["No favourites yet", "Star a chat to keep it at the top."],
  groups: ["No groups yet", "Start one with New chat."],
};

/** The unread colour: the time on an unread chat, its badge, a favourite's ring. */
const UNREAD_TEXT = "text-[#c94a32] dark:text-[#ff9a85]";
const UNREAD_FILL = "bg-[#c94a32] text-white";

/**
 * The person's own colour on an avatar: the same stable per-name hue the buyer
 * cards wear (`glowVars`, lib/ui/buyer-glow.ts), read through `--ink`/`--glow`.
 * Round for a person, a rounded square for a group or channel.
 */
export const AVATAR_TINT =
  "bg-[color-mix(in_srgb,var(--glow)_20%,var(--surface))] text-[var(--ink)] dark:text-[color-mix(in_srgb,var(--ink)_55%,white)]";

export function avatarStyle(name: string): CSSProperties {
  return glowVars(name) as CSSProperties;
}

/**
 * PULSE'S CHAT LIST, THE COLOURFUL REDESIGN (user 2026-10-29, the "Pulse —
 * colourful redesign" board: "apply this in pulse module"). It replaces the
 * dark Slack-style sidebar of the same day. A white card beside the open
 * conversation (comms-shell.tsx, "PULSE IS TWO PANES"):
 *
 * - "Pulse", how many unread messages across how many chats, and New chat.
 * - The search over chats and messages (searchMore — RLS decides every hit).
 * - All · Unread · Favourites · Groups, each a coloured, counted chip.
 * - FAVOURITES as a row of ringed avatars (the ring turns coral while unread).
 * - Archived, then one list of chats, newest first: a coloured avatar, the
 *   name and time, a Group / Channel tag, the last message WhatsApp's way
 *   ("You: …", "ROJA: …"), the star and the unread count.
 *
 * Favourite and Archived are the PERSON's own flags (0764), never the channel
 * archive an admin sets for everyone.
 */
export function ConversationList({
  conversations,
  activeId = null,
  composing = false,
}: {
  conversations: ConversationSummary[];
  /** The conversation open beside the list, lit. */
  activeId?: string | null;
  /** /comms — the New message screen is open beside the list. */
  composing?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showArchived, setShowArchived] = useState(false);
  // Optimistic flags until the refreshed list arrives with the stored ones.
  const [flags, setFlags] = useState<Record<string, Flags>>({});
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [searchingMsgs, setSearchingMsgs] = useState(false);
  const [now] = useState(() => Date.now());
  const [, start] = useTransition();
  const seq = useRef(0);

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

  const all = conversations.map((c) => ({ ...c, ...flags[c.id] }));
  const active = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);
  // Each filter carries how many conversations it would show, counted by the
  // same tests the list uses, so a number and the list under it never disagree.
  const tests: Record<Filter, (c: ConversationSummary) => boolean> = {
    all: () => true,
    unread: (c) => c.unread_count > 0,
    favorites: (c) => c.favorite,
    groups: (c) => c.kind === "group",
  };

  const lower = term.toLowerCase();
  const shown = searching
    ? all.filter((c) => c.title.toLowerCase().includes(lower) || (c.last_body ?? "").toLowerCase().includes(lower))
    : active.filter(tests[filter]);
  const favourites = !searching && filter === "all" ? active.filter((c) => c.favorite) : [];
  const msgHits = term.length >= 2 ? hits : [];
  const unreadTotal = active.reduce((n, c) => n + (c.id === activeId || c.muted ? 0 : c.unread_count), 0);
  const summary = `${unreadTotal ? `${unreadTotal} unread ${unreadTotal === 1 ? "message" : "messages"}` : "All caught up"} · ${active.length} ${active.length === 1 ? "chat" : "chats"}`;

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

  const row = (c: ConversationSummary) => (
    <Row key={c.id} c={c} when={when(c.last_message_at)} active={c.id === activeId} onFlag={(ch) => flag(c, ch)} />
  );

  if (showArchived) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <header className="flex items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            aria-label="Back to chats"
            title="Back to chats"
            className="rounded-xl p-2.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <h1 className="text-lg font-extrabold tracking-tight text-heading">Archived</h1>
        </header>
        <p className="bg-surface-muted px-4 py-2.5 text-xs text-muted-foreground">
          Archived chats stay here when new messages arrive. Unarchive to move a chat back to Pulse.
        </p>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2" aria-label="Archived chats">
          {archived.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No archived chats.</p>
          ) : (
            <ul className="space-y-0.5">{archived.map(row)}</ul>
          )}
        </nav>
      </div>
    );
  }

  const [emptyTitle, emptyText] = searching
    ? [`No chats match “${term}”`, "Try a name, a department or words from a message."]
    : EMPTY[filter];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="space-y-3.5 px-4 pb-3.5 pt-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Activity className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-heading">Pulse</h1>
            <p className="text-[13px] text-muted-foreground">{summary}</p>
          </div>
          {/* The To: screen is the right-hand pane, so a phone (one pane at a
              time) gets the tap-a-person sheet instead. */}
          <Link
            href="/comms"
            aria-current={composing ? "page" : undefined}
            className={buttonClasses({ className: cn(NEW_CHAT, "hidden @3xl/comms:inline-flex") })}
          >
            <Plus aria-hidden /> New chat
          </Link>
          <Link href="/comms?new=1" className={buttonClasses({ className: cn(NEW_CHAT, "@3xl/comms:hidden") })}>
            <Plus aria-hidden /> New chat
          </Link>
        </div>

        <div role="search" className="relative">
          {term.length >= 2 && searchingMsgs ? (
            <Loader2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          )}
          {/* caps-input: exempt -- a search box; the query is not a stored value */}
          <Input
            type="search"
            uppercase={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.preventDefault();
                e.stopPropagation();
                setQ("");
              }
            }}
            placeholder="Search chats and messages"
            aria-label="Search chats and messages"
            className="h-11 rounded-xl border-transparent bg-surface-muted pl-10 pr-9 focus-visible:bg-surface [&::-webkit-search-cancel-button]:appearance-none"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              title="Clear search (Esc)"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>

        {!searching && (
          <div role="group" aria-label="Show chats" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const on = filter === f.value;
              const count = active.filter(tests[f.value]).length;
              return (
                // button-shape: exempt -- Pulse's colour-coded filter chips (user 2026-10-29, the colourful redesign): each pill wears its own hue, dot and count, which ToggleGroup's one lit colour cannot draw
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full border pl-2.5 pr-1.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? f.on : "border-border bg-surface text-foreground hover:bg-surface-muted",
                  )}
                >
                  <span aria-hidden className={cn("h-2 w-2 rounded-full", f.dot)} />
                  {f.label}
                  <span
                    className={cn(
                      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums",
                      on ? f.count : "bg-surface-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {favourites.length > 0 && (
        <section aria-label="Favourites" className="border-b border-border px-4 pb-3.5">
          <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Favourites</p>
          <ul className="flex gap-2.5 overflow-x-auto pb-1">
            {favourites.map((c) => (
              <li key={c.id}>
                <Story c={c} unread={c.id !== activeId && c.unread_count > 0} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4 pt-2" aria-label="Chats">
        {!searching && filter === "all" && archived.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className="mb-1 flex w-full items-center gap-3 rounded-2xl bg-surface-muted px-3 py-2.5 text-left hover:bg-[color-mix(in_srgb,var(--surface-muted)_70%,var(--border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,#6c5ce7_16%,var(--surface))] text-[#5b4bd6] dark:text-[#b4a9ff]">
              <Archive className="h-[18px] w-[18px]" />
            </span>
            <span className="flex-1 text-sm font-bold text-foreground">Archived</span>
            <span className="rounded-full bg-[color-mix(in_srgb,#6c5ce7_16%,var(--surface))] px-2.5 py-0.5 text-xs font-bold tabular-nums text-[#5b4bd6] dark:text-[#b4a9ff]">
              {archived.length}
            </span>
          </button>
        )}

        {searching && shown.length > 0 && <Caption>Chats</Caption>}
        {shown.length > 0 ? (
          <ul className="space-y-0.5">{shown.map(row)}</ul>
        ) : (
          <div className="mx-4 my-8 flex flex-col items-center gap-2 text-center">
            <span aria-hidden className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-[color-mix(in_srgb,#f0705a_14%,var(--surface))] text-[#c94a32]">
              <MessageCircle className="h-6 w-6" />
            </span>
            <p className="text-[15px] font-bold text-foreground">{emptyTitle}</p>
            <p className="text-[13px] text-muted-foreground">{emptyText}</p>
          </div>
        )}

        {term.length >= 2 && (
          <section aria-label="Messages" className="mt-3">
            <Caption>Messages</Caption>
            {searchingMsgs && msgHits.length === 0 ? (
              <p className="px-3 py-1 text-xs text-muted-foreground">Searching…</p>
            ) : msgHits.length === 0 ? (
              <p className="px-3 py-1 text-xs text-muted-foreground">No messages match “{term}”.</p>
            ) : (
              <ul className="space-y-0.5">
                {msgHits.map((h) => (
                  <li key={h.message.id}>
                    <Link
                      href={messageHref(h.message)}
                      className="flex flex-col gap-0.5 rounded-2xl px-3 py-2 text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="break-words font-bold text-foreground">{h.conversation_title}</span>
                      <Truncated
                        text={`${h.message.author_name ? `${h.message.author_name}: ` : ""}${h.message.body ?? ""}`}
                        className="block text-xs text-muted-foreground"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!searching && filter === "all" && (
          <Link
            href="/comms/channels"
            className="mt-2 flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Compass className="h-4 w-4" aria-hidden /> Browse channels
          </Link>
        )}
      </nav>
    </div>
  );
}

/** New chat: the one filled button in the pane, in the redesign's coral. */
const NEW_CHAT = "shrink-0 gap-2 bg-[#c94a32] px-3.5 font-bold text-white hover:bg-[#b23f29]";

function Caption({ children }: { children: string }) {
  return <p className="px-3 pb-1 pt-1 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">{children}</p>;
}

/** What a row's second line says: the last message, WhatsApp's way. */
function preview(c: ConversationSummary): string {
  const name = c.last_author_name;
  const who = name === "You" ? "You: " : c.kind !== "direct" && name ? `${name.split(/[\s.]+/)[0]}: ` : "";
  if (c.last_deleted) return `${who}This message was deleted`;
  if (c.last_body) return `${who}${c.last_body.replace(/<@[0-9a-f-]{36}>/gi, "@…").replace(/<rec:[a-z_]+:[0-9a-f-]{36}>/gi, "[record]")}`;
  if (c.last_has_file) return `${who}Attachment`;
  return c.kind === "direct" ? "No messages yet" : `${c.member_count} members`;
}

function ChatAvatar({ c, size }: { c: ConversationSummary; size: "md" | "lg" }) {
  const channel = c.kind === "channel";
  const Icon = channel ? (c.visibility === "private" ? Lock : Hash) : c.kind === "group" && !c.name ? Users : null;
  return (
    <span
      aria-hidden
      style={avatarStyle(c.title)}
      className={cn(
        "flex shrink-0 items-center justify-center font-extrabold",
        AVATAR_TINT,
        size === "lg" ? "h-12 w-12 text-base" : "h-[50px] w-[50px] text-[17px]",
        c.kind === "direct" ? "rounded-full" : size === "lg" ? "rounded-[14px]" : "rounded-[15px]",
      )}
    >
      {Icon ? <Icon className="h-5 w-5" /> : initials(c.title.replace(/^#/, ""))}
    </span>
  );
}

/** A favourite in the row above the list: a ringed avatar and a first name. */
function Story({ c, unread }: { c: ConversationSummary; unread: boolean }) {
  const label = c.title.replace(/^#/, "");
  return (
    <Link
      href={`/comms/c/${c.id}`}
      aria-label={`Open ${label}${unread ? `, ${c.unread_count} unread` : ""}`}
      className="flex w-16 flex-col items-center gap-1.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        style={avatarStyle(c.title)}
        className={cn(
          "border-2 p-[3px]",
          c.kind === "direct" ? "rounded-full" : "rounded-[18px]",
          unread ? "border-[#f0705a]" : "border-[var(--glow)]",
        )}
      >
        <ChatAvatar c={c} size="md" />
      </span>
      <span className="max-w-16 truncate text-xs font-semibold text-foreground">{label.split(/[\s.]+/)[0]}</span>
    </Link>
  );
}

/**
 * One chat card: avatar, name and time, a Group / Channel tag, the last
 * message, the star and the unread count — and, on hover or keyboard focus,
 * star and archive buttons. RESPONSIVE: with a mouse those float over the
 * card's top-right corner; on a touch screen (no hover) they sit at the card's
 * end, always shown, at a 36px target. They are siblings of the card's link,
 * never inside it, so a tap on them never opens the chat.
 */
function Row({
  c,
  when,
  active,
  onFlag,
}: {
  c: ConversationSummary;
  when: string;
  active: boolean;
  onFlag: (change: Flags) => void;
}) {
  const unread = active || c.muted ? 0 : c.unread_count;
  const label = c.title.replace(/^#/, "");
  const tag = c.kind === "group" ? "Group" : c.kind === "channel" ? "Channel" : null;
  return (
    <li className="group/row relative flex items-center">
      <Link
        href={`/comms/c/${c.id}`}
        aria-current={active ? "page" : undefined}
        aria-label={`${label}${unread ? `, ${unread} unread` : ""}${c.mention_count && !active ? `, ${c.mention_count} mentioning you` : ""}${c.favorite ? ", favourite" : ""}`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-surface-muted",
          c.muted && !active && "opacity-60",
        )}
      >
        <ChatAvatar c={c} size="lg" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <Truncated text={label} className="min-w-0 flex-1 text-[15px] font-bold text-heading" />
            <span className={cn("shrink-0 text-xs tabular-nums", unread > 0 ? cn("font-extrabold", UNREAD_TEXT) : "font-medium text-muted-foreground")}>
              {when}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {tag && (
              <span
                className={cn(
                  "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-extrabold",
                  tag === "Group"
                    ? "bg-[color-mix(in_srgb,#6c5ce7_14%,var(--surface))] text-[#5b4bd6] dark:text-[#b4a9ff]"
                    : "bg-primary-soft text-primary",
                )}
              >
                {tag}
              </span>
            )}
            <Truncated text={preview(c)} className={cn("min-w-0 flex-1 text-[13px]", unread > 0 ? "font-semibold text-foreground" : "text-muted-foreground")} />
            {c.mention_count > 0 && !active && (
              <span className={cn("shrink-0 text-xs font-extrabold", UNREAD_TEXT)} aria-hidden>
                @
              </span>
            )}
            {c.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-[#f2a541] text-[#f2a541]" aria-hidden />}
            {unread > 0 && (
              <span
                className={cn("flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-extrabold tabular-nums", UNREAD_FILL)}
                aria-hidden
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
        </span>
      </Link>
      <div className="flex shrink-0 gap-0.5 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 [@media(hover:hover)]:absolute [@media(hover:hover)]:right-2 [@media(hover:hover)]:top-1.5 [@media(hover:hover)]:rounded-xl [@media(hover:hover)]:bg-surface [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:shadow-sm">
        <button
          type="button"
          onClick={() => onFlag({ favorite: !c.favorite })}
          aria-label={c.favorite ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
          title={c.favorite ? "Remove from favourites" : "Add to favourites"}
          className="rounded-xl p-2.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:p-1.5"
        >
          <Star className={cn("h-4 w-4", c.favorite && "fill-[#f2a541] text-[#f2a541]")} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onFlag({ archived: !c.archived })}
          aria-label={c.archived ? `Unarchive ${label}` : `Archive ${label}`}
          title={c.archived ? "Unarchive" : "Archive"}
          className="rounded-xl p-2.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:p-1.5"
        >
          {c.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </li>
  );
}
