"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  BellOff,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  Heart,
  HeartOff,
  LogOut,
  Megaphone,
  Pin,
  PinOff,
  Hash,
  Loader2,
  Lock,
  MessageCircle,
  Plus,
  Search,
  SquarePen,
  Star,
  Users,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { joinChannel, leaveConversation, markRead, setChatFlags, setMuted } from "@/lib/comms/actions";
import { setConversationPrefs } from "@/lib/comms/channel-actions";
import { loadChannelsToFind, loadPulseFiles } from "@/lib/comms/pulse-actions";
import type { FileKind, PulseFile } from "@/lib/comms/files-service";
import { messageHref } from "@/lib/comms/search";
import { searchMore } from "@/lib/comms/search-actions";
import type { ChannelListing, CommunitySummary, ConversationSummary, MessageHit } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { glowVars } from "@/lib/ui/buyer-glow";
import { cn } from "@/lib/utils";
import { clockTime, fileSize, initials } from "./message-body";
import { CommunityAvatar } from "./community-avatar";
import { NewCommunitySheet } from "./new-community-sheet";
import { PhotoImg, useUserPhoto } from "./person-photo";
import { nameCase } from "@/lib/comms/name-case";

type Filter = "all" | "unread" | "favorites" | "groups" | "communities" | "channels" | "files";

/**
 * WHATSAPP'S FILTER ROW (user 2026-10-31, screenshots 115240 / 122326 / 122843,
 * and the Pulse Communities mockup: "apply this artifact").
 *
 * TWO STATES, as WhatsApp (screenshots 115240 · 122326 · 113348 · 113356):
 *  - an ordinary filter → All · Unread · Favourites · Groups · ▾, and ▾ holds
 *    only Communities, Channels, Files, each with its count;
 *  - Communities / Channels / Files chosen → the row shrinks to
 *    All · <that one> · ▾, and ▾ lists EVERY filter with the tick on it. Neutral outlined
 * pills with the chosen one light green, a round ▾, and NO sideways scrolling:
 * the row wraps at the very narrowest instead. This replaces the 2026-10-29
 * one-colour-per-filter chips.
 */
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "favorites", label: "Favourites" },
  { value: "groups", label: "Groups" },
  { value: "communities", label: "Communities" },
  { value: "channels", label: "Channels" },
  { value: "files", label: "Files" },
];
const ROW: Filter[] = ["all", "unread", "favorites", "groups"];

const CHIP =
  "inline-flex h-8 min-w-0 items-center gap-1 md:h-6 whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold md:px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_OFF = "border-[#d1d7db] bg-surface text-[#54656f] hover:bg-surface-muted dark:border-[#3b4a54] dark:text-[#aebac1]";
// The chosen filter, the unread counts and the search focus follow the theme
// colour (user 2026-11-02) instead of WhatsApp's green and the old coral.
const CHIP_ON = "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-primary-soft text-primary";

/** The Communities green, for the announcement tag and the community rows. */
const COMMUNITY_TINT = "bg-[color-mix(in_srgb,#1f9d6b_14%,var(--surface))] text-[#137a52] dark:text-[#6fdcaa]";

const EMPTY: Record<Filter, [string, string]> = {
  all: ["No chats yet", "Start one with New chat."],
  unread: ["You are all caught up", "New messages will show up here."],
  favorites: ["No favourites yet", "Star a chat to keep it at the top."],
  groups: ["No groups yet", "Start one with New chat."],
  communities: ["No communities yet", "Start one with New community, or ask an admin to add you."],
  channels: ["No channels yet", "Join one below, or browse every channel."],
  files: ["No files yet", "Files shared in your chats, groups and channels show up here."],
};

/** The unread colour: the time on an unread chat, its badge, a favourite's ring. */
const UNREAD_TEXT = "text-primary";
const UNREAD_FILL = "bg-primary text-primary-foreground";

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
 *
 * ## THE FILTER ROW IS WHATSAPP'S (user 2026-10-31, the Pulse Communities mockup)
 *
 * All · Unread · Favourites · Groups as chips, then ▾ (screenshot 115240). The
 * ▾ menu holds every filter with its count and a tick, Communities included;
 * picking Communities adds its green chip to the row. On a narrow phone the
 * row scrolls sideways rather than wrapping onto a second line.
 *
 * ## COMMUNITIES (0775)
 *
 * The Communities filter lists the person's communities the way WhatsApp
 * does: the community, then its Announcements, then the groups of it they are
 * in (two, then "View all"). The community itself opens its page beside the
 * list (/comms/community/<id>). Before 0775 is applied `communities` is null
 * and the filter says so instead of reading empty.
 */
export function ConversationList({
  conversations,
  activeId = null,
  composing = false,
  communities,
  activeCommunityId = null,
  activeFileId = null,
}: {
  conversations: ConversationSummary[];
  /** 0775: the caller's communities; null when 0775 is not applied. */
  communities?: CommunitySummary[] | null;
  /** The community page open beside the list, lit. */
  activeCommunityId?: string | null;
  /** The file open beside the list (/comms/files/<id>), lit. */
  activeFileId?: string | null;
  /** The conversation open beside the list, lit. */
  activeId?: string | null;
  /** /comms — the New message screen is open beside the list. */
  composing?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const canCreateChannel = hasPermission(useAppUser(), "communication", "create");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(activeCommunityId ? "communities" : activeFileId ? "files" : "all");
  const [newCommunity, setNewCommunity] = useState(false);
  // Channels ▸ Find channels and Files are read only once their filter is
  // picked (pulse-actions.ts); null = not read yet.
  const [findChannels, setFindChannels] = useState<ChannelListing[] | null>(null);
  const [files, setFiles] = useState<PulseFile[] | null>(null);
  const [lazyError, setLazyError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (filter === "channels" && findChannels === null) {
      void loadChannelsToFind().then((r) => live && (r.ok ? setFindChannels(r.channels) : setLazyError(r.error)));
    }
    if (filter === "files" && files === null) {
      void loadPulseFiles().then((r) => live && (r.ok ? setFiles(r.files) : setLazyError(r.error)));
    }
    return () => {
      live = false;
    };
  }, [filter, findChannels, files]);
  const [showArchived, setShowArchived] = useState(false);
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [searchingMsgs, setSearchingMsgs] = useState(false);
  const [now] = useState(() => Date.now());
  const [, start] = useTransition();
  // The ⌄ menu on each row (user 2026-11-02, WhatsApp's chat menu).
  const [menuBusy, startMenu] = useTransition();
  const [leaving, setLeaving] = useState<ConversationSummary | null>(null);
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

  // A pinned chat sits at the top, newest activity first among the pinned
  // (sort is stable, so each half keeps the server's order).
  const all = [...conversations].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const active = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);
  // Each filter carries how many conversations it would show, counted by the
  // same tests the list uses, so a number and the list under it never disagree.
  const tests: Record<Filter, (c: ConversationSummary) => boolean> = {
    all: () => true,
    unread: (c) => c.unread_count > 0,
    favorites: (c) => c.favorite,
    groups: (c) => c.kind === "group",
    communities: (c) => !!c.community_id,
    channels: (c) => c.kind === "channel",
    files: () => false,
  };
  const communityList = communities ?? [];
  const communityName = new Map(communityList.map((cm) => [cm.id, cm.name]));
  // WhatsApp's Communities number: communities with something unread in them.
  const unreadIn = (cm: CommunitySummary) =>
    active.some((c) => (c.community_id === cm.id || c.id === cm.announcement_id) && c.id !== activeId && !c.muted && c.unread_count > 0);
  const weekAgo = now - 7 * 86_400_000;
  const countOf = (f: Filter): number =>
    f === "communities"
      ? communityList.filter(unreadIn).length
      : f === "channels"
        ? active.filter((c) => c.kind === "channel" && c.id !== activeId && !c.muted && c.unread_count > 0).length
        : f === "files"
          ? (files ?? []).filter((x) => new Date(x.created_at).getTime() >= weekAgo).length
          : active.filter(tests[f]).length;

  const lower = term.toLowerCase();
  const shown = searching
    ? all.filter((c) => c.title.toLowerCase().includes(lower) || (c.last_body ?? "").toLowerCase().includes(lower))
    : active.filter(tests[filter]);
  // Announcements and community groups go under Groups: anything that is not a
  // person-to-person chat or a channel.
  const sections: { key: "direct" | "group" | "channel"; title: string; items: ConversationSummary[] }[] = [
    { key: "direct", title: "Direct messages", items: shown.filter((c) => c.kind === "direct") },
    { key: "group", title: "Groups", items: shown.filter((c) => c.kind !== "direct" && c.kind !== "channel") },
    { key: "channel", title: "Channels", items: shown.filter((c) => c.kind === "channel") },
  ];
  const browseRow = !searching && filter === "all";
  const msgHits = term.length >= 2 ? hits : [];

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

  /**
   * THE ROW'S ⌄ MENU (user 2026-11-02): WhatsApp's chat menu, holding only what
   * the database can already do — archive, mark read, favourite, mute, leave.
   * The same actions the open chat's ⋮ menu runs (conversation-view.tsx).
   */
  function runMenu(task: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string, after?: () => void) {
    startMenu(async () => {
      const r = await task();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (done) toast.success(done);
      after?.();
      router.refresh();
    });
  }
  const rowMenu = (c: ConversationSummary): DropdownItem[] => [
    {
      label: c.archived ? "Unarchive chat" : "Archive chat",
      icon: c.archived ? ArchiveRestore : Archive,
      disabled: menuBusy,
      onClick: () =>
        runMenu(
          () => setChatFlags({ conversation_id: c.id, archived: !c.archived }),
          c.archived ? `${c.title} moved back to Pulse` : `${c.title} archived`,
          () => {
            if (!c.archived && c.id === activeId) router.push("/comms");
          },
        ),
    },
    {
      label: c.pinned ? "Unpin chat" : "Pin chat",
      icon: c.pinned ? PinOff : Pin,
      disabled: menuBusy,
      onClick: () =>
        runMenu(
          () => setConversationPrefs({ conversation_id: c.id, pinned: !c.pinned }),
          c.pinned ? "Chat unpinned" : "Chat pinned",
        ),
    },
    ...(c.unread_count > 0 && c.id !== activeId
      ? [{ label: "Mark as read", icon: CheckCheck, disabled: menuBusy, onClick: () => runMenu(() => markRead(c.id)) }]
      : []),
    {
      label: c.favorite ? "Remove from favourites" : "Add to favourites",
      icon: c.favorite ? HeartOff : Heart,
      disabled: menuBusy,
      onClick: () =>
        runMenu(
          () => setChatFlags({ conversation_id: c.id, favorite: !c.favorite }),
          c.favorite ? "Removed from favourites" : "Added to favourites",
        ),
    },
    {
      label: c.muted ? "Unmute notifications" : "Mute notifications",
      icon: c.muted ? Bell : BellOff,
      disabled: menuBusy,
      onClick: () => runMenu(() => setMuted(c.id, !c.muted), c.muted ? "Notifications on" : "Notifications muted"),
    },
    ...(c.kind !== "direct" && !c.is_announcement
      ? [
          {
            label: c.kind === "channel" ? "Leave channel" : "Exit group",
            icon: LogOut,
            danger: true,
            separatorBefore: true,
            disabled: menuBusy,
            onClick: () => setLeaving(c),
          },
        ]
      : []),
  ];

  const row = (c: ConversationSummary, sectioned = false) => (
    <Row
      key={c.id}
      c={c}
      sectioned={sectioned}
      when={when(c.last_message_at)}
      active={c.id === activeId}
      community={c.community_id ? communityName.get(c.community_id) ?? null : null}
      menu={rowMenu(c)}
    />
  );

  const leaveDialog = (
    <ConfirmDialog
      open={!!leaving}
      title={`Leave ${leaving?.title ?? ""}?`}
      body="You keep what was said before you left. Someone can add you back later."
      confirmLabel={leaving?.kind === "channel" ? "Leave channel" : "Exit group"}
      isPending={menuBusy}
      onCancel={() => setLeaving(null)}
      onConfirm={() => {
        const c = leaving;
        if (!c) return;
        runMenu(
          () => leaveConversation(c.id),
          c.kind === "channel" ? `You left #${c.title.replace(/^#/, "")}` : `You left ${c.title}`,
          () => {
            setLeaving(null);
            if (c.id === activeId) router.push("/comms");
          },
        );
      }}
    />
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
            <ul className="space-y-0.5">{archived.map((c) => row(c))}</ul>
          )}
        </nav>
        {leaveDialog}
      </div>
    );
  }

  const [emptyTitle, emptyText] = searching
    ? [`No chats match “${term}”`, "Try a name, a department or words from a message."]
    : EMPTY[filter];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {/* WhatsApp Web spacing (user 2026-11-02): 16px side margin, 12px between
          search, chips and the list. */}
      <header className="space-y-1.5 py-2 pl-1.5 pr-1 md:py-1.5">
        {/* No "Pulse" title or "All caught up · N chats" line (user 2026-11-02:
            remove the words) — the heading stays for screen readers only. */}
        <h1 className="sr-only">Pulse</h1>

        {/* WhatsApp Web's header (user 2026-11-02, option A): New chat is a small
            round icon on the search row, not a big red button on its own row. */}
        <div className="flex items-center gap-2">
        <div role="search" className="relative min-w-0 flex-1">
          {term.length >= 2 && searchingMsgs ? (
            <Loader2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#54656f] dark:text-[#aebac1]" aria-hidden />
          ) : (
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#54656f] dark:text-[#aebac1]" aria-hidden />
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
            aria-label="Search or start a new chat"
            // WhatsApp Web's search (user 2026-11-02): a 40px pill on a warm grey.
            className="h-10 rounded-full border-2 border-transparent md:h-8 bg-surface-muted pl-10 pr-9 text-[12.5px] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-surface focus-visible:ring-0 md:text-[12.5px] [&::-webkit-search-cancel-button]:appearance-none"
          />
          {/* A drawn label, not a placeholder: placeholders are switched off app-wide
              (lib/ui/placeholders.ts), and this box is the one that should say what it is
              (user 2026-11-03). Gone as soon as anything is typed. */}
          {!q && (
            <span className="pointer-events-none absolute inset-y-0 left-10 right-3 flex items-center truncate text-[12.5px] text-muted-foreground">
              Search or start a new chat
            </span>
          )}
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
          {/* The To: screen is the right-hand pane, so a phone (one pane at a
              time) gets the tap-a-person sheet instead. */}
          <Link
            href="/comms"
            aria-current={composing ? "page" : undefined}
            aria-label="New chat"
            title="New chat"
            className={cn(NEW_CHAT, "hidden @3xl/comms:grid")}
          >
            <SquarePen className="h-5 w-5" aria-hidden />
          </Link>
          <Link href="/comms?new=1" aria-label="New chat" title="New chat" className={cn(NEW_CHAT, "grid @3xl/comms:hidden")}>
            <SquarePen className="h-5 w-5" aria-hidden />
          </Link>
        </div>

        {!searching && (
          // ONE ROW, ALWAYS (user 2026-11-02): the five filters never wrap; on a pane
          // too narrow for them the words give way with an ellipsis, the ⌄ never does.
          <div role="group" aria-label="Show chats" className="scrollbar-none flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto">
            {(ROW.includes(filter) ? FILTERS.filter((f) => ROW.includes(f.value)) : FILTERS.filter((f) => f.value === "all" || f.value === filter)).map((f) => {
              const on = filter === f.value;
              const count = f.value === "all" ? 0 : countOf(f.value);
              return (
                // button-shape: exempt -- WhatsApp's filter chips (user 2026-10-31, screenshots 115240 / 122843): outlined pills, the chosen one green, which ToggleGroup's track cannot draw
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f.value)}
                  className={cn(CHIP, "shrink-0", on ? CHIP_ON : CHIP_OFF)}
                >
                  {/* truncate-reveal: exempt -- a fixed filter word, shortened only on a pane narrower than any real one */}
                  <span className="min-w-0 truncate">{f.label}</span>
                  {/* A zero says nothing — the number shows only when there is one. */}
                  {count > 0 && <span className="shrink-0 text-xs tabular-nums opacity-90">{count}</span>}
                </button>
              );
            })}
            <DropdownMenu
              label="More filters"
              trigger={<ChevronDown className="h-4 w-4" aria-hidden />}
              triggerClassName={cn(CHIP, CHIP_OFF, "w-6 shrink-0 justify-center px-0")}
              items={(ROW.includes(filter) ? FILTERS.filter((f) => !ROW.includes(f.value)) : FILTERS).map((f) => ({
                label: f.label,
                checked: filter === f.value,
                count: f.value === "all" ? undefined : countOf(f.value),
                onClick: () => setFilter(f.value),
              }))}
            />
          </div>
        )}
      </header>

      {!searching && filter === "channels" ? (
        <nav className="min-h-0 flex-1 overflow-y-auto border-t border-border px-2 pb-2 pt-1" aria-label="Channels">
          <Caption>Channels you are in</Caption>
          {active.some((c) => c.kind === "channel") ? (
            <ul className="space-y-0.5">{active.filter((c) => c.kind === "channel").map((c) => row(c))}</ul>
          ) : (
            <p className="px-3 py-2 text-[13px] text-muted-foreground">{EMPTY.channels[0]}. {EMPTY.channels[1]}</p>
          )}
          <Caption>Find channels</Caption>
          {findChannels === null ? (
            lazyError ? (
              <p className="px-3 py-2 text-[13px] text-danger" role="alert">{lazyError}</p>
            ) : (
              <p className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading channels…
              </p>
            )
          ) : findChannels.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-muted-foreground">You are in every public channel.</p>
          ) : (
            <ul className="space-y-0.5">
              {findChannels.map((ch) => (
                <FindChannel
                  key={ch.id}
                  ch={ch}
                  active={ch.id === activeId}
                  onJoin={() =>
                    start(async () => {
                      const r = await joinChannel(ch.id);
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success(`You joined #${ch.name}`);
                      setFindChannels((list) => (list ?? []).filter((x) => x.id !== ch.id));
                      router.push(`/comms/c/${ch.id}`);
                      router.refresh();
                    })
                  }
                />
              ))}
            </ul>
          )}
          <Link
            href="/comms/channels"
            className="mt-2 flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Compass className="h-4 w-4" aria-hidden /> Browse all channels
          </Link>
        </nav>
      ) : !searching && filter === "files" ? (
        <FilesPane files={files} error={lazyError} activeFileId={activeFileId} now={now} />
      ) : !searching && filter === "communities" ? (
        <nav className="min-h-0 flex-1 overflow-y-auto border-t border-border px-2 pb-2 pt-1" aria-label="Communities">
          {communities === null ? (
            <p className="mx-4 my-8 text-center text-[13px] text-muted-foreground" role="status">
              Communities are not set up in this database yet. Ask your administrator to apply migration 0775.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setNewCommunity(true)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", COMMUNITY_TINT)}>
                  <Plus className="h-5 w-5" />
                </span>
                <span className="text-[15px] font-bold text-heading">New community</span>
              </button>
              {communityList.length === 0 ? (
                <div className="mx-4 my-8 flex flex-col items-center gap-2 text-center">
                  <p className="text-[15px] font-bold text-foreground">{EMPTY.communities[0]}</p>
                  <p className="text-[13px] text-muted-foreground">{EMPTY.communities[1]}</p>
                </div>
              ) : (
                communityList.map((cm) => (
                  <CommunityBlock
                    key={cm.id}
                    cm={cm}
                    chats={active}
                    activeId={activeId}
                    activeCommunityId={activeCommunityId}
                    when={when}
                  />
                ))
              )}
            </>
          )}
        </nav>
      ) : (
        <>
      {/* No Favourites strip above the list (user 2026-11-04, the mockup has
          none); a favourite still wears its star on the row. */}
      <nav className="scrollbar-none min-h-0 flex-1 overflow-y-auto pb-2" aria-label="Chats">
        {!searching && filter === "all" && archived.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className="mb-1 flex w-full items-center gap-2.5 rounded-xl bg-surface-muted px-2.5 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--surface-muted)_70%,var(--border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,#6c5ce7_16%,var(--surface))] text-[#5b4bd6] dark:text-[#b4a9ff]">
              <Archive className="h-[18px] w-[18px]" />
            </span>
            <span className="flex-1 text-sm font-bold text-foreground">Archived</span>
            <span className="rounded-full bg-[color-mix(in_srgb,#6c5ce7_16%,var(--surface))] px-2.5 py-0.5 text-xs font-bold tabular-nums text-[#5b4bd6] dark:text-[#b4a9ff]">
              {archived.length}
            </span>
          </button>
        )}

        {/* DIRECT MESSAGES · GROUPS · CHANNELS (user 2026-11-04, the Pulse mobile
            mockup): the filter chips stay, and whatever they show is split by
            kind under its own heading, newest first within it. A heading with
            nothing under it is not drawn, except Channels under All, which
            always carries Browse channels (it used to be pinned under the list;
            since 2026-11-04 it is an icon on that heading).
            The headings do not fold: a fold here would have to be an accordion
            (one open at a time), which would hide one kind behind the other. */}
        {shown.length > 0 || browseRow ? (
          <>
            {sections.map((s) =>
              s.items.length === 0 && !(s.key === "channel" && browseRow) ? null : (
                <section key={s.key} aria-labelledby={`pulse-sec-${s.key}`}>
                  <h2
                    id={`pulse-sec-${s.key}`}
                    className="flex items-center gap-2 border-t border-border px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-[0.06em] text-primary first-of-type:border-t-0"
                  >
                    {s.title}
                    {s.items.length > 0 && <span className="font-medium normal-case tracking-normal text-muted-foreground tabular-nums">{s.items.length}</span>}
                    {/* BROWSE AND NEW ON THE HEADING, as in the sidebar (user
                        2026-11-04, screenshot 4034): "Browse channels" was the
                        last row of the section, so every channel joined pushed
                        it further down the list. */}
                    {s.key === "channel" && (
                      <span className="ml-auto flex items-center gap-0.5 normal-case tracking-normal">
                        <Link
                          href="/comms/channels"
                          title="Browse channels"
                          aria-label="Browse channels"
                          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                        >
                          <Search className="h-4 w-4" aria-hidden />
                        </Link>
                        {canCreateChannel && (
                          <Link
                            href="/comms/channels?create=1"
                            title="New channel"
                            aria-label="New channel"
                            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                          >
                            <Plus className="h-4 w-4" aria-hidden />
                          </Link>
                        )}
                      </span>
                    )}
                  </h2>
                  {s.items.length > 0 && <ul>{s.items.map((c) => row(c, true))}</ul>}
                </section>
              ),
            )}
          </>
        ) : (
          <div className="mx-4 my-8 flex flex-col items-center gap-2 text-center">
            <span aria-hidden className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-primary-soft text-primary">
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

      </nav>
        </>
      )}
      {communities !== null && communities !== undefined && (
        <NewCommunitySheet open={newCommunity} onClose={() => setNewCommunity(false)} taken={communityList.map((cm) => cm.name)} />
      )}
      {leaveDialog}
    </div>
  );
}

/** A public channel the person is not in: open it to read, or Join. */
function FindChannel({ ch, active, onJoin }: { ch: ChannelListing; active: boolean; onJoin: () => void }) {
  return (
    <li className="flex items-center gap-2">
      <Link
        href={`/comms/c/${ch.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "bg-primary-soft" : "hover:bg-surface-muted",
        )}
      >
        <span
          aria-hidden
          style={avatarStyle(ch.name)}
          className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-extrabold", AVATAR_TINT)}
        >
          <Hash className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <Truncated text={ch.name} className="text-[15px] font-bold text-heading" />
          <Truncated text={ch.topic ?? ch.department_name ?? "Public channel"} className="text-[13px] text-muted-foreground" />
        </span>
      </Link>
      {/* button-shape: exempt -- WhatsApp's outlined Join pill beside a channel (user 2026-10-31, the Pulse mockup) */}
      <button
        type="button"
        onClick={onJoin}
        className="mr-1 h-8 shrink-0 rounded-full border border-[#15603e] px-3.5 text-[13px] font-bold text-[#15603e] hover:bg-[#d9fdd3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-[#7ae3a5] dark:text-[#7ae3a5] dark:hover:bg-[#103529]"
      >
        Join
      </button>
    </li>
  );
}

const FILE_TABS: { value: "all" | FileKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "doc", label: "Documents" },
  { value: "sheet", label: "Sheets" },
  { value: "pdf", label: "PDFs" },
  { value: "image", label: "Images" },
];

/** A file's type tile — the same colours on the list and the file's page. */
export const FILE_TILE: Record<FileKind, [string, string]> = {
  pdf: ["PDF", "bg-[#fde3e0] text-[#b42318] dark:bg-[#3b1d1a] dark:text-[#ff9f94]"],
  sheet: ["XLS", "bg-[#dcf5e8] text-[#137a52] dark:bg-[#12302a] dark:text-[#6fdcaa]"],
  image: ["IMG", "bg-[#ece8ff] text-[#5b4bd6] dark:bg-[#262046] dark:text-[#b4a9ff]"],
  doc: ["DOC", "bg-[#e3ecff] text-[#2f5bd3] dark:bg-[#1d2740] dark:text-[#8aa8ff]"],
  other: ["FILE", "bg-surface-muted text-muted-foreground"],
};

/**
 * Pulse ▸ Files: everything shared in the person's conversations, newest
 * first, in This week / Earlier, with type tabs. A file opens its own page
 * beside the list (/comms/files/<id>), with where it was shared.
 */
function FilesPane({ files, error, activeFileId, now }: { files: PulseFile[] | null; error: string | null; activeFileId: string | null; now: number }) {
  const [tab, setTab] = useState<"all" | FileKind>("all");
  const list = (files ?? []).filter((f) => tab === "all" || f.kind === tab);
  const weekAgo = now - 7 * 86_400_000;
  const recent = list.filter((f) => new Date(f.created_at).getTime() >= weekAgo);
  const older = list.filter((f) => new Date(f.created_at).getTime() < weekAgo);
  const item = (f: PulseFile) => {
    const [tag, tint] = FILE_TILE[f.kind];
    const on = f.id === activeFileId;
    return (
      <li key={f.id}>
        <Link
          href={`/comms/files/${f.id}`}
          aria-current={on ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            on ? "bg-primary-soft" : "hover:bg-surface-muted",
          )}
        >
          <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold tracking-wide", tint)}>
            {tag}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <Truncated text={f.file_name} className="min-w-0 flex-1 text-sm font-bold text-heading" />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDate(f.created_at)}</span>
            </span>
            <Truncated
              text={`${fileSize(f.size_bytes)} · ${f.conversation_title}${f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ""}`}
              className="text-[13px] text-muted-foreground"
            />
          </span>
        </Link>
      </li>
    );
  };
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto border-t border-border px-2 pb-2 pt-1.5" aria-label="Files">
      <div role="group" aria-label="File types" className="mb-1 flex flex-wrap gap-1.5 px-1">
        {FILE_TABS.map((t) => (
          // button-shape: exempt -- the file-type tabs under Pulse ▸ Files, the same outlined pills as the filter row
          <button
            key={t.value}
            type="button"
            aria-pressed={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(CHIP, "h-7 px-2.5 text-[13px] max-[420px]:h-7", tab === t.value ? CHIP_ON : CHIP_OFF)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {files === null ? (
        error ? (
          <p className="px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>
        ) : (
          <p className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading files…
          </p>
        )
      ) : list.length === 0 ? (
        <div className="mx-4 my-8 flex flex-col items-center gap-2 text-center">
          <span aria-hidden className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-surface-muted text-muted-foreground">
            <FileText className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-bold text-foreground">{tab === "all" ? EMPTY.files[0] : "No files of this type"}</p>
          {tab === "all" && <p className="text-[13px] text-muted-foreground">{EMPTY.files[1]}</p>}
        </div>
      ) : (
        <>
          {recent.length > 0 && (
            <>
              <Caption>This week</Caption>
              <ul className="space-y-0.5">{recent.map(item)}</ul>
            </>
          )}
          {older.length > 0 && (
            <>
              <Caption>Earlier</Caption>
              <ul className="space-y-0.5">{older.map(item)}</ul>
            </>
          )}
        </>
      )}
    </nav>
  );
}

/**
 * One community in the Communities filter, WhatsApp's shape: the community
 * (opens its page), its Announcements, the first two groups of it the person
 * is in, and "View all" when there are more.
 */
function CommunityBlock({
  cm,
  chats,
  activeId,
  activeCommunityId,
  when,
}: {
  cm: CommunitySummary;
  chats: ConversationSummary[];
  activeId: string | null;
  activeCommunityId: string | null;
  when: (iso: string | null) => string;
}) {
  const ann = chats.find((c) => c.id === cm.announcement_id) ?? null;
  const mine = chats.filter((c) => c.community_id === cm.id && !c.is_announcement);
  const shown = mine.slice(0, 2);
  const lit = activeCommunityId === cm.id;
  const sub = (c: ConversationSummary, label: string, icon: ReactNode) => {
    const on = c.id === activeId;
    const unread = on || c.muted ? 0 : c.unread_count;
    return (
      <li key={c.id}>
        <Link
          href={`/comms/c/${c.id}`}
          aria-current={on ? "page" : undefined}
          aria-label={`${label}${unread ? `, ${unread} unread` : ""}`}
          className={cn(
            "flex items-center gap-2.5 rounded-xl py-1.5 pl-6 pr-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            on ? "bg-primary-soft" : "hover:bg-surface-muted",
          )}
        >
          {icon}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <Truncated text={label} className="min-w-0 flex-1 text-sm font-bold text-heading" />
              <span className={cn("shrink-0 text-xs tabular-nums", unread > 0 ? cn("font-extrabold", UNREAD_TEXT) : "text-muted-foreground")}>
                {when(c.last_message_at)}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Truncated text={preview(c)} className="min-w-0 flex-1 text-[13px] text-muted-foreground" />
              {unread > 0 && (
                <span aria-hidden className={cn("flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-extrabold tabular-nums", UNREAD_FILL)}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </span>
          </span>
        </Link>
      </li>
    );
  };
  return (
    <section aria-label={cm.name} className="border-b border-border py-1 last:border-b-0">
      <Link
        href={`/comms/community/${cm.id}`}
        aria-current={lit ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          lit ? "bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-surface-muted",
        )}
      >
        <CommunityAvatar name={cm.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <Truncated text={cm.name} className="text-[15px] font-bold text-heading" />
          <span className="text-[13px] text-muted-foreground">
            {cm.group_count} {cm.group_count === 1 ? "group" : "groups"} · {cm.member_count} {cm.member_count === 1 ? "member" : "members"}
          </span>
        </span>
      </Link>
      <ul>
        {ann &&
          sub(
            ann,
            "Announcements",
            <span aria-hidden className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", COMMUNITY_TINT)}>
              <Megaphone className="h-[18px] w-[18px]" />
            </span>,
          )}
        {shown.map((c) => sub(c, c.title, <ChatAvatar c={c} size="sm" />))}
      </ul>
      {cm.group_count > shown.length && (
        <Link
          href={`/comms/community/${cm.id}`}
          className="flex items-center gap-1.5 rounded-xl py-1.5 pl-7 pr-2.5 text-[13px] font-semibold text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="h-4 w-4" aria-hidden /> View all {cm.group_count} groups
        </Link>
      )}
    </section>
  );
}

/** New chat: the one filled button in the pane, in the redesign's coral. */
// A 40px round grey icon button, WhatsApp Web style; the open To: screen keeps it tinted.
const NEW_CHAT =
  "h-10 w-10 shrink-0 place-items-center rounded-full text-[#54656f] md:h-8 md:w-8 transition-colors hover:bg-[#f0f2f5] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-[#f0f2f5] aria-[current=page]:text-foreground dark:text-[#aebac1] dark:hover:bg-[#202c33] dark:aria-[current=page]:bg-[#202c33]";

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

function ChatAvatar({ c, size }: { c: ConversationSummary; size: "sm" | "md" | "lg" | "compact" }) {
  const photo = useUserPhoto(c.kind === "direct" ? c.other_user_id : null);
  const channel = c.kind === "channel";
  // A CHANNEL SHOWS ITS LETTER, NOT A "#" (user 2026-11-04), the same as the
  // sidebar's ChannelAvatar; a private one keeps a small lock on the corner.
  // An announcement channel keeps its megaphone — that says what it is FOR.
  const Icon = c.is_announcement ? Megaphone : c.kind === "group" && !c.name ? Users : null;
  const letter = channel ? (c.title.match(/[\p{L}\p{N}]/u)?.[0] ?? "#").toUpperCase() : null;
  const box = (
    <span
      aria-hidden
      style={avatarStyle(c.title)}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden font-extrabold",
        AVATAR_TINT,
        size === "compact" ? "h-[38px] w-[38px] text-[13px] max-md:h-10 max-md:w-10 max-md:text-sm" : size === "sm" ? "h-9 w-9 text-sm" : size === "lg" ? "h-11 w-11 text-sm" : "h-[50px] w-[50px] text-[17px]",
        c.kind === "direct" ? "rounded-full" : size === "md" ? "rounded-[15px]" : "rounded-xl",
      )}
    >
      {photo ? <PhotoImg src={photo} /> : Icon ? <Icon className="h-5 w-5" /> : (letter ?? initials(c.title.replace(/^#/, "")))}
    </span>
  );
  if (!(channel && c.visibility === "private")) return box;
  return (
    <span className="relative inline-flex shrink-0">
      {box}
      <span aria-label="Private" className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-surface text-muted-foreground ring-2 ring-surface">
        <Lock className="h-2.5 w-2.5" aria-hidden />
      </span>
    </span>
  );
}

/**
 * One chat card: avatar, name and time, a Group / Channel tag, the last
 * message, the star and the unread count. No star / archive buttons on the
 * row (user 2026-11-02) — favourite and archive live in the open chat's menu.
 */
function Row({
  c,
  when,
  active,
  community,
  menu,
  sectioned = false,
}: {
  c: ConversationSummary;
  when: string;
  active: boolean;
  /** Under a Groups / Channels heading: the heading says the kind, so the row drops its Group / Channel tag. */
  sectioned?: boolean;
  /** 0775: the community this group is in — its name replaces the Group tag. */
  community: string | null;
  /** The ⌄ menu's items (ConversationList's `rowMenu`). */
  menu: DropdownItem[];
}) {
  const unread = active || c.muted ? 0 : c.unread_count;
  const label = c.kind === "direct" ? nameCase(c.title) : c.title.replace(/^#/, "");
  const tag = c.is_announcement
    ? "Announcements"
    : community
      ? community
      : sectioned
        ? null
        : c.kind === "group"
          ? "Group"
          : c.kind === "channel"
            ? "Channel"
            : null;
  return (
    <li className="group/row relative flex items-center">
      <Link
        href={`/comms/c/${c.id}`}
        aria-current={active ? "page" : undefined}
        aria-label={`${label}${unread ? `, ${unread} unread` : ""}${c.mention_count && !active ? `, ${c.mention_count} mentioning you` : ""}${c.favorite ? ", favourite" : ""}`}
        className={cn(
          "flex min-h-12 min-w-0 flex-1 items-center gap-3 py-1.5 pl-1.5 pr-1 transition-colors md:gap-2 md:py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "bg-surface-muted" : "hover:bg-surface-muted",
          c.muted && !active && "opacity-60",
        )}
      >
        <ChatAvatar c={c} size="compact" />
        {/* The divider runs edge to edge on the row itself (user 2026-11-02). */}
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 self-stretch">
          <span className="flex items-center gap-2">
            <Truncated text={label} className="min-w-0 flex-1 text-sm font-semibold leading-snug text-heading" />
            <span className={cn("shrink-0 text-[11.5px] tabular-nums", unread > 0 ? cn("font-extrabold", UNREAD_TEXT) : "font-medium text-muted-foreground")}>
              {when}
            </span>
          </span>
          {/* No padding change on hover (user 2026-11-02): the ⌄ floats over the row, so the text never reflows. */}
          <span className="flex items-center gap-2">
            {tag && (
              // A community's name can be long; it is cut at 45% of the row and
              // reads whole on hover / press (Truncated).
              <Truncated
                text={tag}
                className={cn(
                  "max-w-[45%] shrink-0 rounded px-1.5 text-[10px] font-extrabold",
                  c.is_announcement || community
                    ? COMMUNITY_TINT
                    : tag === "Group"
                      ? "bg-[color-mix(in_srgb,#6c5ce7_14%,var(--surface))] text-[#5b4bd6] dark:text-[#b4a9ff]"
                      : "bg-primary-soft text-primary",
                )}
              />
            )}
            {/* No message text in the list (user 2026-11-03) — just the unread count. The text is in the chat. */}
            <span className="min-w-0 flex-1" />
            {c.mention_count > 0 && !active && (
              <span className={cn("shrink-0 text-xs font-extrabold", UNREAD_TEXT)} aria-hidden>
                @
              </span>
            )}
            {c.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Muted" />}
            {c.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />}
            {c.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-[#f2a541] text-[#f2a541]" aria-hidden />}
            {unread > 0 && (
              <span
                className={cn("flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11.5px] font-extrabold tabular-nums", UNREAD_FILL)}
                aria-hidden
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
        </span>
      </Link>
      {/* WHATSAPP'S ⌄ (user 2026-11-02): appears on hover or keyboard focus at
          the row's bottom-right, always on a touch screen. A sibling of the
          link, never inside it, so opening the menu never opens the chat. */}
      <div className="absolute bottom-[6px] right-1 rounded-md bg-surface-muted opacity-0 max-md:hidden transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100">
        <DropdownMenu
          label={`Actions for ${label}`}
          trigger={<ChevronDown className="h-5 w-5" aria-hidden />}
          triggerClassName="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          items={menu}
          menuWidth={232}
        />
      </div>
    </li>
  );
}
