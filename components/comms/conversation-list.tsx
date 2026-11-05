"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  Ban,
  Eye,
  EyeOff,
  MessageSquareDot,
  MessageSquareText,
  Repeat,
  Volume2,
  VolumeX,
  ChevronsDownUp,
  ChevronsUpDown,
  EllipsisVertical,
  FolderInput,
  FolderMinus,
  Trash2,
  UserPlus,
  AtSign,
  Bell,
  BellOff,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  Heart,
  HeartOff,
  House,
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
  Star,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { deleteChatForMe, joinChannel, leaveConversation, markRead, markThreadSeen, markUnread, setBlocked, setChatFlags, setMuted } from "@/lib/comms/actions";
import { setConversationPrefs } from "@/lib/comms/channel-actions";
import { loadChannelsToFind, loadPulseFiles } from "@/lib/comms/pulse-actions";
import type { FileKind, PulseFile } from "@/lib/comms/files-service";
import { messageHref } from "@/lib/comms/search";
import { searchMore } from "@/lib/comms/search-actions";
import type { ChannelListing, CommunitySummary, ConversationSummary, MessageHit, ThreadSummary } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { glowVars } from "@/lib/ui/buyer-glow";
import { cn } from "@/lib/utils";
import { clockTime, fileSize, initials } from "./message-body";
import { CommunityAvatar } from "./community-avatar";
import { NewCommunitySheet } from "./new-community-sheet";
import { PhotoImg, useUserPhoto } from "./person-photo";
import { ShortScrollbar } from "./short-scrollbar";
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
  { value: "favorites", label: "Starred" },
  { value: "groups", label: "Groups" },
  { value: "communities", label: "Communities" },
  { value: "channels", label: "Channels" },
  { value: "files", label: "Files" },
];

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
  favorites: ["Nothing starred yet", "Star a chat from its ⌄ menu to keep it here."],
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
  threads = [],
  activeId = null,
  composing = false,
  home = false,
  communities,
  activeCommunityId = null,
  activeFileId = null,
}: {
  conversations: ConversationSummary[];
  /** 0811: threads the caller started or replied in, newest reply first. */
  threads?: ThreadSummary[];
  /** 0775: the caller's communities; null when 0775 is not applied. */
  communities?: CommunitySummary[] | null;
  /** The community page open beside the list, lit. */
  activeCommunityId?: string | null;
  /** The file open beside the list (/comms/files/<id>), lit. */
  activeFileId?: string | null;
  /** The conversation open beside the list, lit. */
  activeId?: string | null;
  /** /comms/new — the New message screen is open beside the list. */
  composing?: boolean;
  /** /comms — the Home feed is open beside the list (lights the Home shortcut). */
  home?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const me = useAppUser();
  const canCreateChannel = hasPermission(me, "communication", "create");

  // YOUR OWN SECTIONS (user 2026-11-05, artifact "section ⋮ menu": "Create new
  // section"). Kept in THIS BROWSER, per login — there is no table for them
  // yet, and a database change needs the user's go-ahead (AGENTS). A chat sits
  // in at most one; moving it out returns it to its kind's heading. Read after
  // mount (localStorage does not exist on the server) and declared above the
  // Archived early return (AGENTS "Hooks above every early return").
  const sectionsKey = `pulse:sections:${me.id}`;
  const [mySections, setMySections] = useState<MySection[]>([]);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMySections(readSections(sectionsKey)));
    return () => cancelAnimationFrame(raf);
  }, [sectionsKey]);
  function saveSections(next: MySection[]) {
    setMySections(next);
    try {
      localStorage.setItem(sectionsKey, JSON.stringify(next));
    } catch {
      /* storage full or blocked: the change still holds until reload */
    }
  }
  // FOLDING HEADINGS (user 2026-11-05, screenshots 103830 / 143311: "add this
  // type of dropdown in shortcut, direct message, channel and threads"): a ▾
  // before each heading folds THAT section only, and the choice is kept in
  // this browser, per login. Deliberately NOT an accordion (AGENTS "Folds are
  // accordions"): these are kinds of chat, not steps of one editor, and the
  // user's own screenshot keeps several open at once. The open chat is never
  // hidden by a fold, and a search ignores folds.
  const foldKey = `pulse:folded:${me.id}`;
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const v: unknown = JSON.parse(localStorage.getItem(foldKey) ?? "{}");
        if (v && typeof v === "object") setFolded(v as Record<string, boolean>);
      } catch {
        /* unreadable: everything open */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [foldKey]);
  function toggleFold(key: string) {
    setFolded((f) => {
      const next = { ...f, [key]: !f[key] };
      try {
        localStorage.setItem(foldKey, JSON.stringify(next));
      } catch {
        /* storage blocked: holds until reload */
      }
      return next;
    });
  }
  function moveTo(chatId: string, sectionId: string | null) {
    saveSections(mySections.map((ms) => ({ ...ms, ids: [...ms.ids.filter((x) => x !== chatId), ...(ms.id === sectionId ? [chatId] : [])] })));
  }
  const [naming, setNaming] = useState(false);
  const [sectionName, setSectionName] = useState("");
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
  // The person-chat ⌄ menu's follow-ups (user 2026-11-05, artifact "Pulse Chat
  // Menu"): each opens a small surface of its own.
  const [notifyFor, setNotifyFor] = useState<ConversationSummary | null>(null);
  const [moveFor, setMoveFor] = useState<ConversationSummary | null>(null);
  const [blocking, setBlocking] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const seq = useRef(0);

  // "↓ N MORE UNREAD" (user 2026-11-05, the chat-app mockup): how many unread
  // rows sit below the list's visible edge. Measured from the DOM on scroll —
  // rows carry `data-unread` — so it counts exactly what the operator cannot
  // see, whatever filter or search is drawing the list. Declared above the
  // Archived early return (AGENTS "Hooks above every early return").
  // PER-SECTION "UNREAD ONLY" SWITCH (user 2026-11-05, chat-app reference
  // "Toggle unread filter"): on a heading, narrows just that section.
  const [unreadOnly, setUnreadOnly] = useState<Record<string, boolean>>({});
  // SHOW ALL / SHOW FEWER (user 2026-11-05, chat-app reference): a section
  // longer than SECTION_PEEK rows shows its newest SECTION_PEEK until opened.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLElement>(null);
  const [below, setBelow] = useState(0);
  useEffect(() => {
    const nav = listRef.current;
    if (!nav) return;
    const measure = () => {
      const edge = nav.getBoundingClientRect().bottom - 4;
      setBelow(Array.from(nav.querySelectorAll("[data-unread]")).filter((el) => el.getBoundingClientRect().top >= edge).length);
    };
    const raf = requestAnimationFrame(measure);
    nav.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      nav.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [conversations, filter, q, showArchived]);
  function nextUnread() {
    const nav = listRef.current;
    if (!nav) return;
    const edge = nav.getBoundingClientRect().bottom - 4;
    const el = Array.from(nav.querySelectorAll("[data-unread]")).find((x) => x.getBoundingClientRect().top >= edge);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

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
  // A chat moved into one of your sections leaves its kind's heading.
  const placed = new Map<string, string>();
  for (const ms of mySections) for (const id of ms.ids) placed.set(id, ms.id);
  const loose = shown.filter((c) => !placed.has(c.id));
  const sections: { key: string; title: string; items: ConversationSummary[]; mine?: MySection }[] = [
    ...mySections.map((ms) => ({ key: `my-${ms.id}`, title: ms.name, items: shown.filter((c) => placed.get(c.id) === ms.id), mine: ms })),
    // NO GROUPS HEADING (user 2026-11-05, screenshot 160050: "remove this
    // groups field"). Group chats, announcements and community groups now sit
    // with the person chats under Direct messages, in the same newest-first
    // order — the heading went, the chats did not.
    { key: "direct", title: "Direct messages", items: loose.filter((c) => c.kind !== "channel") },
    { key: "channel", title: "Channels", items: loose.filter((c) => c.kind === "channel") },
  ];
  const takenNames = new Set(["DIRECT MESSAGES", "GROUPS", "CHANNELS", ...mySections.map((ms) => ms.name.toUpperCase())]);
  const newName = sectionName.trim();
  const nameProblem = newName && takenNames.has(newName.toUpperCase()) ? "A section with this name already exists." : null;
  // The heading's ⋮ (user 2026-11-05, artifact "section ⋮ menu"): two items —
  // the way to start one of THIS kind, and Create new section.
  const sectionMenu = (s: (typeof sections)[number]): DropdownItem[] => [
    ...(s.mine
      ? [{ label: "Delete section", icon: Trash2, danger: true, onClick: () => saveSections(mySections.filter((x) => x.id !== s.mine?.id)) }]
      : s.key === "direct"
        ? [
            { label: "Start direct message", icon: MessageCircle, onClick: () => router.push("/comms?new=1") },
            // New group moved here with the group chats when Groups lost its heading.
            { label: "New group", icon: Users, onClick: () => router.push("/comms?new=1&a=group") },
          ]
        : // Channels ⋮ (user 2026-11-05, artifact "Channels ⋮ menu"): Create a
            // channel · Create new section. Browse channels was removed the same
            // day at the user's request; the heading's 🔍 ＋ icons left it too.
            [
              ...(canCreateChannel
                ? [{ label: "Create a channel", icon: UserPlus, onClick: () => router.push("/comms/channels?create=1") }]
                : []),
            ]),
    {
      label: "Create new section",
      icon: Plus,
      onClick: () => {
        setSectionName("");
        setNaming(true);
      },
    },
  ];
  const browseRow = !searching && filter === "all";
  // The Mentions shortcut's badge: unread @mentions across chats, the same
  // per-chat `mention_count` the row's "@" reads (never the open chat's).
  const mentions = active.reduce((n, c) => n + (c.id === activeId ? 0 : c.mention_count || 0), 0);
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
  /**
   * THE PERSON-CHAT ⌄ MENU (user 2026-11-05, artifact "Pulse Chat Menu"), in
   * Gmail chat's order: everyday actions, a rule, then Block · Hide · Delete.
   * Hide is 0764's archive; Block and Delete are 0810's. Star is not in it.
   * Groups and channels keep the menu below, with Exit / Leave.
   */
  const personMenu = (c: ConversationSummary): DropdownItem[] => [
    ...(c.unread_count > 0 && c.id !== activeId
      ? [{ label: "Mark as read", icon: CheckCheck, disabled: menuBusy, onClick: () => runMenu(() => markRead(c.id)) }]
      : c.id !== activeId && c.last_author_id && c.last_author_id !== me.id
        ? [{ label: "Mark as unread", icon: MessageSquareDot, disabled: menuBusy, onClick: () => runMenu(() => markUnread(c.id)) }]
        : []),
    {
      label: c.pinned ? "Unpin" : "Pin",
      icon: c.pinned ? PinOff : Pin,
      disabled: menuBusy,
      onClick: () =>
        runMenu(() => setConversationPrefs({ conversation_id: c.id, pinned: !c.pinned }), c.pinned ? "Chat unpinned" : "Chat pinned"),
    },
    {
      label: c.muted ? "Unmute" : "Mute",
      hint: c.muted ? "Notifications paused" : "Pause notifications",
      icon: c.muted ? Volume2 : VolumeX,
      disabled: menuBusy,
      onClick: () => runMenu(() => setMuted(c.id, !c.muted), c.muted ? "Notifications on" : "Notifications muted"),
    },
    {
      label: "Notifications",
      hint: NOTIFY_LABEL[c.notify_level ?? "all"],
      icon: Bell,
      disabled: menuBusy,
      onClick: () => setNotifyFor(c),
    },
    { label: "Move conversation", icon: Repeat, onClick: () => setMoveFor(c) },
    {
      label: c.blocked ? "Unblock" : "Block",
      icon: Ban,
      separatorBefore: true,
      disabled: menuBusy || !c.other_user_id,
      onClick: () =>
        c.blocked && c.other_user_id
          ? runMenu(() => setBlocked(c.other_user_id as string, false), `${c.title} unblocked`)
          : setBlocking(c),
    },
    {
      label: c.archived ? "Unhide conversation" : "Hide conversation",
      icon: c.archived ? Eye : EyeOff,
      disabled: menuBusy,
      onClick: () =>
        runMenu(
          () => setChatFlags({ conversation_id: c.id, archived: !c.archived }),
          c.archived ? `${c.title} moved back to Pulse` : `${c.title} hidden. Find it under Archived.`,
          () => {
            if (!c.archived && c.id === activeId) router.push("/comms");
          },
        ),
    },
    { label: "Delete conversation", icon: Trash2, danger: true, disabled: menuBusy, onClick: () => setDeleting(c) },
  ];

  const rowMenu = (c: ConversationSummary): DropdownItem[] => (c.kind === "direct" ? personMenu(c) : groupMenu(c));
  const groupMenu = (c: ConversationSummary): DropdownItem[] => [
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
      label: c.favorite ? "Unstar chat" : "Star chat",
      icon: c.favorite ? HeartOff : Heart,
      disabled: menuBusy,
      onClick: () =>
        runMenu(
          () => setChatFlags({ conversation_id: c.id, favorite: !c.favorite }),
          c.favorite ? "Chat unstarred" : "Chat starred",
        ),
    },
    {
      label: c.muted ? "Unmute notifications" : "Mute notifications",
      icon: c.muted ? Bell : BellOff,
      disabled: menuBusy,
      onClick: () => runMenu(() => setMuted(c.id, !c.muted), c.muted ? "Notifications on" : "Notifications muted"),
    },
    // Your own sections (this browser): move the chat in, or back out.
    ...mySections
      .filter((ms) => placed.get(c.id) !== ms.id)
      .map((ms, i) => ({ label: `Move to ${ms.name}`, icon: FolderInput, separatorBefore: i === 0, onClick: () => moveTo(c.id, ms.id) })),
    ...(placed.has(c.id) ? [{ label: "Remove from section", icon: FolderMinus, onClick: () => moveTo(c.id, null) }] : []),
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
    <>
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
    <ConfirmDialog
      open={!!blocking}
      title={`Block ${blocking?.title ?? ""}?`}
      body="Neither of you can send messages in this chat until you unblock them. Groups and channels are not affected."
      confirmLabel="Block"
      isPending={menuBusy}
      onCancel={() => setBlocking(null)}
      onConfirm={() => {
        const c = blocking;
        if (!c?.other_user_id) return;
        runMenu(() => setBlocked(c.other_user_id as string, true), `${c.title} blocked`, () => setBlocking(null));
      }}
    />
    <ConfirmDialog
      open={!!deleting}
      title={`Delete chat with ${deleting?.title ?? ""}?`}
      body="The chat and its messages are removed from your Pulse only. The other person keeps them. The chat comes back if they write again."
      confirmLabel="Delete conversation"
      isPending={menuBusy}
      onCancel={() => setDeleting(null)}
      onConfirm={() => {
        const c = deleting;
        if (!c) return;
        runMenu(() => deleteChatForMe(c.id), "Conversation deleted", () => {
          setDeleting(null);
          if (placed.has(c.id)) moveTo(c.id, null);
          if (c.id === activeId) router.push("/comms");
        });
      }}
    />
    <Sheet open={!!notifyFor} onClose={() => setNotifyFor(null)} title="Notifications" size="sm" alignToPane>
      <Field label={`Notify me about ${notifyFor?.title ?? ""}`}>
        <Segmented
          name="pulse-notify-level"
          value={notifyFor?.notify_level ?? "all"}
          options={(["all", "mentions", "none"] as const).map((v) => ({ value: v, label: NOTIFY_LABEL[v] }))}
          disabled={menuBusy}
          onChange={(v) => {
            const c = notifyFor;
            if (!c) return;
            runMenu(
              () => setConversationPrefs({ conversation_id: c.id, notify_level: v }),
              `Notifications: ${NOTIFY_LABEL[v]}`,
              () => setNotifyFor(null),
            );
          }}
        />
      </Field>
    </Sheet>
    <Sheet open={!!moveFor} onClose={() => setMoveFor(null)} title="Move conversation" size="sm" alignToPane>
      {mySections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have no sections yet. Create one from the ⋮ on a heading such as Direct messages, then move this chat into it.
        </p>
      ) : (
        <Field label={`Section for ${moveFor?.title ?? ""}`}>
          <Segmented
            name="pulse-move-section"
            value={(moveFor ? placed.get(moveFor.id) : undefined) ?? ""}
            options={[{ value: "", label: "Direct messages" }, ...mySections.map((ms) => ({ value: ms.id, label: ms.name }))]}
            onChange={(v) => {
              const c = moveFor;
              if (!c) return;
              moveTo(c.id, v || null);
              setMoveFor(null);
              toast.success(v ? `Moved to ${mySections.find((ms) => ms.id === v)?.name ?? "section"}` : "Moved back to Direct messages");
            }}
          />
        </Field>
      )}
    </Sheet>
    </>
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
        {/* "＋ NEW" ON THE SEARCH ROW (user 2026-11-05, artifact "＋ New pill",
            proposed placement): a small tinted pill replacing the big New chat
            button and its row. The To: screen is the right-hand pane, so a phone
            (one pane at a time) gets the tap-a-person sheet instead. */}
        <Link
          href="/comms/new"
          aria-current={composing ? "page" : undefined}
          aria-label="New chat"
          title="New chat"
          className={cn(NEW_CHAT, "hidden @3xl/comms:inline-flex")}
        >
          <Plus className="h-4 w-4" aria-hidden /> New
        </Link>
        <Link href="/comms?new=1" aria-label="New chat" title="New chat" className={cn(NEW_CHAT, "inline-flex @3xl/comms:hidden")}>
          <Plus className="h-4 w-4" aria-hidden /> New
        </Link>
        </div>

        {/* NO FILTER CHIPS (user 2026-11-05: "remove this"). What they did now
            lives in the list itself: Unread is each heading's switch, Groups and
            Channels are headings (Channels' 🔍 finds more), and Favourites,
            Communities and Files are Shortcuts. Inside one of those views a
            back row says where you are and returns to all chats. */}
        {!searching && filter !== "all" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              aria-label="Back to all chats"
              title="Back to all chats"
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="text-sm font-bold text-heading">{FILTERS.find((f) => f.value === filter)?.label}</span>
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
      <div className="relative flex min-h-0 flex-1 flex-col">
      {/* A SHORT HANDLE (user 2026-11-05, "intha scroll bar hight a korai"):
          the native bar is hidden and ShortScrollbar draws a fixed 56px one;
          scrolling itself stays native. It replaced the 4px hairline here. */}
      <ShortScrollbar target={listRef} />
      <nav ref={listRef} className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-1 pb-12" aria-label="Chats">
        {/* SHORTCUTS (user 2026-11-05, the chat-app mockup): Home, Mentions and
            Saved above the chats. Flat since 2026-11-05 (user: "card mari
            irukkathalma remove pannu") — a hairline beneath, no grey box. Under All only — a filter or
            a search is the operator narrowing the list, not navigating. */}
        {!searching && filter === "all" && (
          <section aria-labelledby="pulse-sec-shortcuts" className="mb-1 border-b border-border pb-1">
            <h2 id="pulse-sec-shortcuts" className="flex items-center px-1 pb-0.5 pt-1 text-xs font-semibold text-muted-foreground">
              <FoldToggle title="Shortcuts" folded={!!folded.shortcuts} onToggle={() => toggleFold("shortcuts")} />
            </h2>
            <ul hidden={!!folded.shortcuts}>
              <Shortcut href="/comms" icon={House} label="Home" on={home} />
              <Shortcut href="/comms/notifications" icon={AtSign} label="Mentions" count={mentions} />
              {/* Starred = the chats wearing the star (the Favourites flag, 0764)
                  — user 2026-11-05: Saved, Favourites, Communities and Files
                  removed from the card, Starred added. Saved messages stay
                  reachable from the open chat's menu. */}
              <Shortcut onClick={() => setFilter("favorites")} icon={Star} label="Starred" count={countOf("favorites")} />
            </ul>
          </section>
        )}
        {!searching && filter === "all" && archived.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className="mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            {sections.map((s) => {
              // The heading's unread switch narrows only this section; under the
              // Unread chip or a search it has nothing to add, so it is not drawn.
              const canNarrow = !searching && filter !== "unread" && s.items.length > 0;
              const only = canNarrow && !!unreadOnly[s.key];
              const items = only ? s.items.filter((c) => c.id === activeId || (!c.muted && c.unread_count > 0)) : s.items;
              // An empty section of your own still shows under All, so a section
              // just created is there to move chats into.
              return s.items.length === 0 && !((s.key === "channel" || s.mine) && browseRow) ? null : (
                <section key={s.key} aria-labelledby={`pulse-sec-${s.key}`} className="group/sec">
                  <h2
                    id={`pulse-sec-${s.key}`}
                    // Sentence case, quiet (user 2026-11-05, chat-app mockup) — was
                    // primary-coloured capitals with a rule above each heading.
                    className="flex items-center gap-2 px-1 pb-0.5 pt-3 text-xs font-semibold text-muted-foreground"
                  >
                    <FoldToggle title={s.title} folded={!searching && !!folded[s.key]} onToggle={() => toggleFold(s.key)} disabled={searching} />
                    {/* HOVER ONLY (user 2026-11-05, artifacts "unread switch on hover"
                        and "section ⋮ menu"): the unread switch and the ⋮ are
                        hidden at rest and shown while the mouse is over the
                        section, while either has focus, while the menu is open,
                        and always once the switch is ON (so a shortened section
                        says why). Opacity, not display, so their space is kept and
                        Channels' 🔍 ＋ never jump. A touch screen has no hover, so
                        there they are always shown. */}
                    <span
                      className={cn(
                        "ml-auto flex items-center gap-0.5 transition-opacity",
                        only
                          ? "opacity-100"
                          : "opacity-0 focus-within:opacity-100 group-hover/sec:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100",
                      )}
                    >
                      {canNarrow && (
                        <span title="Unread only" className="flex items-center">
                          <Toggle
                            checked={only}
                            onChange={(v) => setUnreadOnly((m) => ({ ...m, [s.key]: v }))}
                            ariaLabel={`Show only unread in ${s.title}`}
                            className="min-h-0"
                          />
                        </span>
                      )}
                      <DropdownMenu
                        label={`Section actions for ${s.title}`}
                        trigger={<EllipsisVertical className="h-4 w-4" aria-hidden />}
                        triggerClassName="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        items={sectionMenu(s)}
                        compact
                        menuWidth={210}
                      />
                    </span>
                  </h2>
                  {items.length > 0 ? (
                    (() => {
                      // A search shows every hit; otherwise a long section peeks.
                      // The open chat is never hidden by the peek.
                      const shut = !searching && !!folded[s.key];
                      const long = !searching && !shut && items.length > SECTION_PEEK;
                      const open = !!expanded[s.key];
                      let visible = shut ? [] : long && !open ? items.slice(0, SECTION_PEEK) : items;
                      const current = items.find((c) => c.id === activeId);
                      if (current && !visible.includes(current)) visible = [...visible, current];
                      if (visible.length === 0) return null;
                      return (
                        <>
                          <ul>{visible.map((c) => row(c, true))}</ul>
                          {long && (
                            // button-shape: exempt -- a list row ("Show all"), drawn like the chat rows above it
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => setExpanded((m) => ({ ...m, [s.key]: !open }))}
                              className="flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-left text-sm text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10"
                            >
                              {open ? (
                                <ChevronsDownUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                              ) : (
                                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                              )}
                              {open ? "Show fewer" : "Show all"}
                            </button>
                          )}
                        </>
                      );
                    })()
                  ) : only ? (
                    <p className="px-3 py-1.5 text-xs text-muted-foreground">Nothing unread here.</p>
                  ) : s.mine ? (
                    <p className="px-3 py-1.5 text-xs text-muted-foreground">Move chats here from their ⌄ menu.</p>
                  ) : null}
                </section>
              );
            })}
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

        {/* THREADS (0811, user 2026-11-05, the "Threads in the chat list"
            artifact): threads the caller started or replied in, under the
            kinds, newest reply first. Bold with a dot while a reply has not
            been opened; the heading counts those. A row opens the chat with
            its thread in the side panel (?m=&t=, the search hit's link).
            Under All only, like Shortcuts — a filter or a search is the
            operator narrowing the list. Peeks like the sections above. */}
        {!searching && filter === "all" && threads.length > 0 && (() => {
          const shut = !!folded.threads;
          // Unread only (user 2026-11-05, artifact "Threads: unread switch and ⋮
          // on hover") — the same per-section switch the kinds above carry.
          const only = !!unreadOnly.threads;
          const list = only ? threads.filter((t) => t.unread) : threads;
          const long = !shut && list.length > SECTION_PEEK;
          const open = !!expanded.threads;
          const visible = shut ? [] : long && !open ? list.slice(0, SECTION_PEEK) : list;
          const threadMenu: DropdownItem[] = [
            // "Mark all as read" only while something is unread — the menu's
            // own test, since the heading no longer carries a total.
            ...(threads.some((t) => t.unread)
              ? [
                  {
                    label: "Mark all as read",
                    icon: CheckCheck,
                    disabled: menuBusy,
                    onClick: () =>
                      runMenu(async () => {
                        for (const t of threads.filter((x) => x.unread)) {
                          const r = await markThreadSeen(t.id);
                          if (!r.ok) return r;
                        }
                        return { ok: true as const };
                      }, "All threads marked as read"),
                  },
                ]
              : []),
            {
              label: shut ? "Expand section" : "Collapse section",
              icon: shut ? ChevronsUpDown : ChevronsDownUp,
              onClick: () => toggleFold("threads"),
            },
          ];
          const chatOf = new Map(conversations.map((c) => [c.id, c]));
          return (
            <section aria-labelledby="pulse-sec-threads" className="group/sec">
              <h2 id="pulse-sec-threads" className="flex items-center gap-2 px-1 pb-0.5 pt-3 text-xs font-semibold text-muted-foreground">
                {/* No total beside the heading (user 2026-11-05, "not thread 4
                    count"): the number is each thread's own, on its row. */}
                <FoldToggle title="Threads" folded={shut} onToggle={() => toggleFold("threads")} />
                {/* HOVER ONLY, the same rule as the kinds' headings above. */}
                <span
                  className={cn(
                    "ml-auto flex items-center gap-0.5 transition-opacity",
                    only
                      ? "opacity-100"
                      : "opacity-0 focus-within:opacity-100 group-hover/sec:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100",
                  )}
                >
                  <span title="Unread only" className="flex items-center">
                    <Toggle
                      checked={only}
                      onChange={(v) => setUnreadOnly((m) => ({ ...m, threads: v }))}
                      ariaLabel="Show only unread threads"
                      className="min-h-0"
                    />
                  </span>
                  <DropdownMenu
                    label="Section actions for Threads"
                    trigger={<EllipsisVertical className="h-4 w-4" aria-hidden />}
                    triggerClassName="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    items={threadMenu}
                    compact
                    menuWidth={210}
                  />
                </span>
              </h2>
              {only && !shut && list.length === 0 && (
                <p className="px-3 py-1.5 text-xs text-muted-foreground">No new replies.</p>
              )}
              <ul>
                {/* A ROW LIKE A DIRECT MESSAGE (user 2026-11-05, screenshot 144333
                    and the "Threads rows like Direct messages" artifact: "no
                    message … hi hello no need"): the chat's own avatar with a
                    thread mark on its corner, its name, the last reply's time
                    and, under it, the unread replies. The message the thread
                    hangs off is in the hover title and the accessible name, so
                    two threads in one chat can still be told apart. */}
                {visible.map((t) => {
                  const c = chatOf.get(t.conversation_id);
                  const where = c ? (c.kind === "direct" ? nameCase(c.title) : c.title.replace(/^#/, "")) : "Chat";
                  const n = t.unread_count;
                  return (
                    <li key={t.id}>
                      <Link
                        href={messageHref({ conversation_id: t.conversation_id, id: t.id, parent_id: t.id })}
                        title={`Thread on: ${t.preview}`}
                        aria-label={`Thread in ${where} on: ${t.preview}${n ? `, ${n} unread ${n === 1 ? "reply" : "replies"}` : ""}`}
                        className="flex h-[46px] min-w-0 items-center gap-2.5 rounded-2xl pl-1.5 pr-2.5 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-12"
                      >
                        <span className="relative inline-flex shrink-0">
                          {c ? (
                            <ChatAvatar c={c} size="row" />
                          ) : (
                            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                              <MessageSquareText className="h-4 w-4" />
                            </span>
                          )}
                          <span aria-hidden className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-surface text-primary ring-2 ring-surface">
                            <MessageSquareText className="h-2.5 w-2.5" strokeWidth={2.6} />
                          </span>
                        </span>
                        <Truncated
                          text={where}
                          className={cn("min-w-0 flex-1 text-sm leading-snug", n > 0 ? "font-bold text-heading" : "font-medium text-foreground")}
                        />
                        <span className="flex min-w-11 shrink-0 flex-col items-end gap-[3px]">
                          <span className={cn("h-4 text-[11px] leading-4 tabular-nums", n > 0 ? cn("font-extrabold", UNREAD_TEXT) : "font-medium text-muted-foreground")}>
                            {when(t.last_reply_at)}
                          </span>
                          <span className="flex h-5 items-center">
                            {n > 0 && (
                              <span aria-hidden className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums", UNREAD_FILL)}>
                                {n > 99 ? "99+" : n}
                              </span>
                            )}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {long && (
                // button-shape: exempt -- a list row ("Show all"), drawn like the chat rows above it
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded((m) => ({ ...m, threads: !open }))}
                  className="flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-left text-sm text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10"
                >
                  {open ? (
                    <ChevronsDownUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  {open ? "Show fewer" : "Show all threads"}
                </button>
              )}
            </section>
          );
        })()}

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
      {below > 0 && (
        // button-shape: exempt -- a floating pill over the list (chat-app "↓ N more unread"), not an action button
        <button
          type="button"
          onClick={nextUnread}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary-soft px-3.5 py-1.5 text-xs font-bold text-primary shadow-md hover:bg-[color-mix(in_srgb,var(--primary)_20%,var(--surface))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden /> {below} more unread
        </button>
      )}
      </div>
        </>
      )}
      {communities !== null && communities !== undefined && (
        <NewCommunitySheet open={newCommunity} onClose={() => setNewCommunity(false)} taken={communityList.map((cm) => cm.name)} />
      )}
      {leaveDialog}
      <Sheet
        open={naming}
        onClose={() => setNaming(false)}
        title="Create new section"
        size="sm"
        alignToPane
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newName || !!nameProblem}
              onClick={() => {
                saveSections([...mySections, { id: crypto.randomUUID(), name: newName, ids: [] }]);
                setNaming(false);
                toast.success(`Section ${newName} created. Move chats into it from their ⌄ menu.`);
              }}
            >
              Create
            </Button>
          </div>
        }
      >
        <Field label="Section name" required hint={nameProblem ?? "Your own heading, e.g. Buyers. Saved in this browser."}>
          <Input value={sectionName} maxLength={40} onChange={(e) => setSectionName(e.target.value)} aria-invalid={!!nameProblem} autoFocus />
        </Field>
      </Sheet>
    </div>
  );
}

/**
 * A list heading's ▾ and its words, as one button: ▾ open, ▸ folded. The
 * heading's own extras (the unread count, the switch, the ⋮) stay outside it.
 */
function FoldToggle({ title, folded, onToggle, disabled = false }: { title: string; folded: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    // button-shape: exempt -- a list heading (▾ and its words), not an action button
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-expanded={!folded}
      title={folded ? `Show ${title}` : `Hide ${title}`}
      className="-my-0.5 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
    >
      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", folded && "-rotate-90")} strokeWidth={2.4} aria-hidden />
      <span className="min-w-0 break-words">{title}</span>
    </button>
  );
}

/** The Notifications line under the person-chat ⌄ menu (0751 notify_level). */
const NOTIFY_LABEL: Record<"all" | "mentions" | "none", string> = { all: "All", mentions: "Mentions only", none: "Off" };

/** Rows a section shows before "Show all" (user 2026-11-05). */
const SECTION_PEEK = 3;

/** One of the person's own chat-list sections (this browser only). */
type MySection = { id: string; name: string; ids: string[] };

function readSections(key: string): MySection[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v)
      ? v.filter((x): x is MySection => !!x && typeof x.id === "string" && typeof x.name === "string" && Array.isArray(x.ids))
      : [];
  } catch {
    return [];
  }
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

/** "＋ New": a 30px soft-tinted pill on the search row (user 2026-11-05); the open To: screen deepens it. */
const NEW_CHAT =
  "h-[30px] shrink-0 items-center gap-1 rounded-full bg-primary-soft pl-2.5 pr-3 text-[13px] font-bold text-primary transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_20%,var(--surface))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10 aria-[current=page]:bg-[color-mix(in_srgb,var(--primary)_20%,var(--surface))]";

/**
 * One row of the Shortcuts card: a pill like a chat row, a badge only when there
 * is something. A route (`href`) or a view of this list (`onClick`, a filter).
 */
function Shortcut({
  href,
  onClick,
  icon: Icon,
  label,
  count = 0,
  on = false,
}: {
  href?: string;
  onClick?: () => void;
  icon: typeof House;
  label: string;
  count?: number;
  on?: boolean;
}) {
  const cls = cn(
    "flex h-8 w-full items-center gap-2.5 rounded-full px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10",
    on ? "bg-primary-soft font-bold text-primary" : "text-foreground hover:bg-surface",
  );
  const body = (
    <>
      <Icon className={cn("h-4 w-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} aria-hidden />
      <span className="flex-1">{label}</span>
      {count > 0 && (
        <span aria-hidden className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums", UNREAD_FILL)}>
          {count > 99 ? "99+" : count}
        </span>
      )}
    </>
  );
  const name = count > 0 ? `${label}, ${count}` : label;
  return (
    <li>
      {href ? (
        <Link href={href} aria-current={on ? "page" : undefined} aria-label={name} className={cls}>
          {body}
        </Link>
      ) : (
        // button-shape: exempt -- a Shortcuts row (a list item that opens a view), drawn like the chat rows beside it
        <button type="button" onClick={onClick} aria-label={name} className={cls}>
          {body}
        </button>
      )}
    </li>
  );
}

function Caption({ children }: { children: string }) {
  return <p className="px-3 pb-1 pt-1 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">{children}</p>;
}

/** What a row's second line says: the last message, WhatsApp's way. */
export function preview(c: ConversationSummary): string {
  const name = c.last_author_name;
  const who = name === "You" ? "You: " : c.kind !== "direct" && name ? `${name.split(/[\s.]+/)[0]}: ` : "";
  if (c.last_deleted) return `${who}This message was deleted`;
  if (c.last_body) return `${who}${c.last_body.replace(/<@[0-9a-f-]{36}>/gi, "@…").replace(/<rec:[a-z_]+:[0-9a-f-]{36}>/gi, "[record]")}`;
  if (c.last_has_file) return `${who}Attachment`;
  return c.kind === "direct" ? "No messages yet" : `${c.member_count} members`;
}

export function ChatAvatar({ c, size }: { c: ConversationSummary; size: "row" | "sm" | "md" | "lg" | "compact" }) {
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
        size === "row"
          ? "h-8 w-8 text-[11px] max-md:h-9 max-md:w-9 max-md:text-[13px]"
          : size === "compact" ? "h-[38px] w-[38px] text-[13px] max-md:h-10 max-md:w-10 max-md:text-sm" : size === "sm" ? "h-9 w-9 text-sm" : size === "lg" ? "h-11 w-11 text-sm" : "h-[50px] w-[50px] text-[17px]",
        c.kind === "direct" ? "rounded-full" : size === "md" ? "rounded-[15px]" : size === "row" ? "rounded-lg" : "rounded-xl",
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
    // data-unread: what the "↓ N more unread" pill counts (ConversationList).
    <li data-unread={unread > 0 ? "" : undefined} className="group/row relative flex items-center">
      <Link
        href={`/comms/c/${c.id}`}
        aria-current={active ? "page" : undefined}
        aria-label={`${label}${unread ? `, ${unread} unread` : ""}${c.mention_count && !active ? `, ${c.mention_count} mentioning you` : ""}${c.favorite ? ", favourite" : ""}`}
        // ONE LINE, A PILL (user 2026-11-05, chat-app mockup): avatar, name,
        // marks, count and time on a single 36px row; 44px on a phone for the thumb.
        className={cn(
          "flex h-[46px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl pl-1.5 pr-2.5 transition-colors max-md:h-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // The row stays lit while its ⌄ menu is open (artifact "row ⌄ on hover").
          active ? "bg-primary-soft" : "hover:bg-surface-muted group-has-[[aria-expanded=true]]/row:bg-surface-muted",
          c.muted && !active && "opacity-60",
        )}
      >
        <ChatAvatar c={c} size="row" />
        <Truncated
          text={label}
          className={cn(
            "min-w-0 flex-1 text-sm leading-snug",
            active ? "font-bold text-primary" : unread > 0 ? "font-bold text-heading" : "font-medium text-foreground",
          )}
        />
        {tag && (
          // A community's name can be long; it is cut at 40% of the row and
          // reads whole on hover / press (Truncated).
          <Truncated
            text={tag}
            className={cn(
              "max-w-[40%] shrink-0 rounded px-1.5 text-[10px] font-extrabold",
              c.is_announcement || community
                ? COMMUNITY_TINT
                : tag === "Group"
                  ? "bg-[color-mix(in_srgb,#6c5ce7_14%,var(--surface))] text-[#5b4bd6] dark:text-[#b4a9ff]"
                  : "bg-primary-soft text-primary",
            )}
          />
        )}
        {c.mention_count > 0 && !active && (
          <span className={cn("shrink-0 text-xs font-extrabold", UNREAD_TEXT)} aria-hidden>
            @
          </span>
        )}
        {c.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Muted" />}
        {c.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />}
        {c.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-[#f2a541] text-[#f2a541]" aria-hidden />}
        {/* TIME ON TOP, COUNT BENEATH (user 2026-11-05, artifact "unread count
            under the time"): a small right-hand stack, the badge's slot kept
            empty on a read chat so every time lines up. */}
        <span className="flex min-w-11 shrink-0 flex-col items-end gap-[3px]">
          {/* The time never hides now: the ⌄ moved to the line below it. */}
          <span
            className={cn(
              "h-4 text-[11px] leading-4 tabular-nums",
              unread > 0 ? cn("font-extrabold", UNREAD_TEXT) : "font-medium text-muted-foreground",
            )}
          >
            {when}
          </span>
          <span className="flex h-5 items-center gap-0.5">
            {unread > 0 && (
              <span
                className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums", UNREAD_FILL)}
                aria-hidden
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            {/* The ⌄'s slot: zero wide at rest, 20px while the row is hovered,
                focused or its menu is open — so the count steps left and the ⌄
                (a sibling of the link, below) sits in the gap. */}
            <span
              aria-hidden
              className="w-0 transition-[width] max-md:hidden md:group-focus-within/row:w-5 md:group-hover/row:w-5 md:group-has-[[aria-expanded=true]]/row:w-5 [@media(hover:none)]:md:w-5"
            />
          </span>
        </span>
      </Link>
      {/* WHATSAPP'S ⌄ (user 2026-11-05, artifact "row ⌄ on hover, beside the
          count"): a plain grey arrow on the SECOND line, right of the unread
          count, shown on hover / focus / while its menu is open; the time above
          stays. A sibling of the link, never inside it, so opening the menu
          never opens the chat. It sits over the slot the link opens for it. */}
      <div className="absolute bottom-1 right-2.5 opacity-0 max-md:hidden transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100">
        <DropdownMenu
          label={`Actions for ${label}`}
          trigger={<ChevronDown className="h-4 w-4" aria-hidden />}
          triggerClassName="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground aria-[expanded=true]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          items={menu}
          // Compact (user 2026-11-04): still wide enough for "Remove from favourites".
          compact
          menuWidth={196}
        />
      </div>
    </li>
  );
}
