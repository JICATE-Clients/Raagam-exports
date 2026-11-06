import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/server";
import { isInactive } from "@/lib/masters/inactive";
import { foldReactions } from "./reactions";
import { cardKind, type EventData, type PollData, type RsvpAnswer } from "./cards";
import { mentionIds, previewText } from "./format";
import {
  SEARCH_PAGE,
  decodeSearchCursor,
  encodeSearchCursor,
  parseQuery,
  searchTerms,
  type SearchInput,
} from "./search";
import type { ThreadSummary } from "./types";
import {
  MESSAGE_PAGE,
  conversationTitle,
  decodeCursor,
  encodeCursor,
  type ChannelListing,
  type CommMember,
  type CommMessage,
  type ConversationDetail,
  type ConversationKind,
  type ConversationSummary,
  type DirectoryPerson,
  type MemberRole,
  type MessageHit,
  type MessagePage,
  type Visibility,
} from "./types";

/**
 * Reads for the Communication Hub (0737).
 *
 * EVERY READ RUNS AS THE CALLER, through RLS. The gates are
 * `comm_can_read_at()` / `comm_message_visible()` inside the policies, so a
 * guessed conversation id returns nothing rather than a stream — the id is the
 * ARGUMENT to the gate, not a way past it (spec §10). Nothing here uses the
 * admin client.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST (AGENTS.md, under "A second FK
 * breaks every existing embed"): an inbox that silently reads empty is believed.
 * Each reader throws, and `app/(app)/error.tsx` shows it.
 *
 * NO QUERY PER MESSAGE (spec §12): a page of messages is one select with its
 * attachments, reactions and pin embedded, then ONE `creator_names()` call for
 * every author on it and ONE `comm_saved` lookup.
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A failed read, keeping PostgREST's code so `isCommsMissing` can tell
 *  "0737 is not applied" from a real fault. */
class CommsReadError extends Error {
  code: string | null;
  constructor(what: string, error: { message: string; code?: string | null }) {
    super(`Could not read ${what}: ${error.message}`);
    this.code = error.code ?? null;
  }
}

function fail(what: string, error: { message: string; code?: string | null }): never {
  throw new CommsReadError(what, error);
}

/**
 * IS 0737 IN THIS DATABASE? The code lands with a `git pull`; the tables and
 * functions land when someone applies the migration. In between, the sidebar
 * row would open a stack trace (`Could not find the function
 * public.comm_my_conversations(p_kind) in the schema cache`).
 *
 * Narrow on purpose, like lib/approvals/install.ts: only "the function / table
 * does not exist" means not installed. A permission failure or network fault
 * still surfaces as an error, because "apply the migration" is the wrong advice
 * for those.
 *   PGRST202 — PostgREST: function not in its schema cache (an unapplied RPC)
 *   PGRST205 — PostgREST: table not in its schema cache
 *   42883 / 42P01 — Postgres: undefined function / table
 */
const MISSING_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);
export function isCommsMissing(e: unknown): boolean {
  const code = (e as { code?: string | null } | null)?.code ?? null;
  const msg = e instanceof Error ? e.message : "";
  const ours = /comm_/.test(msg);
  if (code && MISSING_CODES.has(code)) return ours;
  return ours && /schema cache|does not exist/i.test(msg);
}

/**
 * uuid → display name, in one call. `creator_names()` and not a PostgREST
 * embed on `profiles`: `profiles_read_own` (0001) hides every other login, so
 * an embed resolves to null for every message anybody else wrote — the reason
 * lib/orders/community/service.ts records at length.
 */
async function resolveNames(s: Sb, ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => typeof v === "string" && UUID_RE.test(v))));
  if (unique.length === 0) return new Map();
  const { data, error } = await s.rpc("creator_names", { ids: unique });
  if (error) fail("names", error);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
}

async function departmentNames(s: Sb, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => !!v)));
  if (unique.length === 0) return new Map();
  const { data, error } = await s.from("departments").select("id, name").in("id", unique);
  if (error) fail("departments", error);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
}

async function myId(): Promise<string | null> {
  return (await getAppUser())?.id ?? null;
}

/**
 * Titles for a set of conversations, as the caller should see them: a DM is
 * named after the OTHER person, an unnamed group after its members. One member
 * query and one names call for the whole set.
 */
async function titlesFor(
  s: Sb,
  convs: { id: string; kind: ConversationKind; name: string | null }[],
  me: string | null,
): Promise<Map<string, string>> {
  const needMembers = convs.filter((c) => c.kind !== "channel" && !(c.name && c.name.trim())).map((c) => c.id);
  const membersOf = new Map<string, string[]>();
  if (needMembers.length > 0) {
    const { data, error } = await s
      .from("comm_members")
      .select("conversation_id, user_id")
      .in("conversation_id", needMembers)
      .is("removed_at", null);
    if (error) fail("conversation members", error);
    for (const r of (data ?? []) as { conversation_id: string; user_id: string }[]) {
      if (r.user_id === me) continue;
      const list = membersOf.get(r.conversation_id) ?? [];
      list.push(r.user_id);
      membersOf.set(r.conversation_id, list);
    }
  }
  const names = await resolveNames(s, Array.from(membersOf.values()).flat());
  return new Map(
    convs.map((c) => [c.id, conversationTitle(c, (membersOf.get(c.id) ?? []).map((u) => names.get(u)))]),
  );
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

type MyConversationRow = Omit<ConversationSummary, "department_name" | "title" | "my_role" | "kind" | "visibility" | "last_author_name"> & {
  kind: ConversationKind;
  visibility: Visibility;
  my_role: MemberRole;
};

/**
 * The caller's conversations, newest activity first, with unread counts.
 * Per-request `cache()`: the hub layout and Chats both ask for it on /comms.
 */
export const listMyConversations = cache(async function listMyConversations(
  kind?: ConversationKind,
): Promise<ConversationSummary[]> {
  const s = await createClient();
  const me = await myId();
  const { data, error } = await s.rpc("comm_my_conversations", { p_kind: kind ?? null });
  if (error) fail("conversations", error);
  const rows = (data ?? []) as MyConversationRow[];

  const [titles, depts, authors, communityOf, prefs] = await Promise.all([
    titlesFor(s, rows, me),
    departmentNames(s, rows.map((r) => r.department_id)),
    // Authors of the last messages and everyone those messages @mention, in one call.
    resolveNames(s, [
      ...rows.map((r) => (r.last_author_id === me ? null : r.last_author_id)),
      ...rows.flatMap((r) => mentionIds(r.last_body)),
    ]),
    communityLinks(s, rows.filter((r) => r.kind === "group").map((r) => r.id)),
    myChatPrefs(s, me),
  ]);
  // 0810 Delete conversation: a chat the caller deleted stays out of their list
  // until someone writes in it again.
  const live = rows.filter((r) => {
    const cleared = prefs.cleared.get(r.id);
    return !cleared || (!!r.last_message_at && Date.parse(r.last_message_at) > Date.parse(cleared));
  });
  return live.map((r) => ({
    ...r,
    pinned: prefs.pinned.has(r.id),
    notify_level: prefs.notify.get(r.id) ?? (r.muted ? "mentions" : "all"),
    blocked: !!r.other_user_id && prefs.blocked.has(r.other_user_id),
    community_id: communityOf.get(r.id)?.community_id ?? null,
    is_announcement: communityOf.get(r.id)?.is_announcement ?? false,
    // `?? false` / `?? null`: before 0764 is applied the RPC has no such columns.
    favorite: r.favorite ?? false,
    archived: r.archived ?? false,
    // The PREVIEW, not the stored text: tokens as names, formatting markers off.
    last_body: r.last_body ? previewText(r.last_body, authors) || null : null,
    last_author_id: r.last_author_id ?? null,
    last_author_name: !r.last_author_id ? null : r.last_author_id === me ? "You" : authors.get(r.last_author_id) ?? null,
    last_deleted: r.last_deleted ?? false,
    last_has_file: r.last_has_file ?? false,
    department_name: r.department_id ? depts.get(r.department_id) ?? null : null,
    title: titles.get(r.id) ?? conversationTitle(r, []),
  }));
});

/**
 * 0775: which community each group belongs to, and which is a community's
 * Announcements chat. Read beside `comm_my_conversations` rather than by
 * re-creating that RPC. Before 0775 is applied the columns do not exist
 * (42703) and every group simply belongs to no community.
 */
/**
 * The caller's own per-chat settings, read from their membership rows: which
 * chats are pinned (0751 pinned_at), the notification level (0751), and when
 * they deleted a chat for themselves (0810 cleared_at). Each column is optional
 * so the list still loads before the migration that adds it.
 */
type MyChatPrefs = {
  pinned: Set<string>;
  notify: Map<string, "all" | "mentions" | "none">;
  cleared: Map<string, string>;
  blocked: Set<string>;
};

async function myChatPrefs(s: Sb, me: string | null): Promise<MyChatPrefs> {
  const out: MyChatPrefs = { pinned: new Set(), notify: new Map(), cleared: new Map(), blocked: new Set() };
  if (!me) return out;
  type Row = { conversation_id: string; pinned_at?: string | null; notify_level?: "all" | "mentions" | "none" | null; cleared_at?: string | null };
  const read = (cols: string) => s.from("comm_members").select(cols).eq("user_id", me).is("removed_at", null);
  let rows: Row[] = [];
  for (const cols of ["conversation_id, pinned_at, notify_level, cleared_at", "conversation_id, pinned_at, notify_level", "conversation_id"]) {
    const { data, error } = await read(cols);
    if (!error) {
      rows = (data ?? []) as unknown as Row[];
      break;
    }
    if (error.code !== "42703") fail("chat settings", error);
  }
  for (const r of rows) {
    if (r.pinned_at) out.pinned.add(r.conversation_id);
    if (r.notify_level) out.notify.set(r.conversation_id, r.notify_level);
    if (r.cleared_at) out.cleared.set(r.conversation_id, r.cleared_at);
  }
  // 0810: who the caller blocked. Missing table → nobody.
  const b = await s.from("comm_blocks").select("blocked_id").eq("blocker_id", me);
  if (b.error && b.error.code !== "42P01" && b.error.code !== "PGRST205") fail("blocked people", b.error);
  for (const r of (b.data ?? []) as { blocked_id: string }[]) out.blocked.add(r.blocked_id);
  return out;
}

async function communityLinks(
  s: Sb,
  ids: string[],
): Promise<Map<string, { community_id: string | null; is_announcement: boolean }>> {
  const out = new Map<string, { community_id: string | null; is_announcement: boolean }>();
  if (ids.length === 0) return out;
  const { data, error } = await s.from("comm_conversations").select("id, community_id, is_announcement").in("id", ids);
  if (error) {
    if (error.code === "42703") return out;
    fail("communities of conversations", error);
  }
  for (const r of (data ?? []) as { id: string; community_id: string | null; is_announcement: boolean }[]) {
    out.set(r.id, { community_id: r.community_id, is_announcement: r.is_announcement });
  }
  return out;
}

/** Total unread across the caller's unmuted, unarchived conversations — the
 *  nav badge. An archived chat stays quiet, as in WhatsApp (0764). */
export async function getUnreadTotal(): Promise<number> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_my_conversations", { p_kind: null });
  if (error) fail("unread messages", error);
  return ((data ?? []) as { unread_count: number; muted: boolean; archived?: boolean }[])
    .filter((r) => !r.muted && !r.archived)
    .reduce((n, r) => n + (r.unread_count ?? 0), 0);
}

/**
 * Every channel the caller may see: all public ones, plus private ones they
 * are or were in. RLS draws that line; this only labels the rows.
 */
export async function listChannels(): Promise<ChannelListing[]> {
  const s = await createClient();
  const [chR, mineR] = await Promise.all([
    s
      .from("comm_conversations")
      .select("id, name, topic, visibility, department_id, is_archived")
      .eq("kind", "channel")
      .order("name"),
    s.rpc("comm_my_conversations", { p_kind: "channel" }),
  ]);
  if (chR.error) fail("channels", chR.error);
  if (mineR.error) fail("your channels", mineR.error);
  const mine = new Set(((mineR.data ?? []) as { id: string }[]).map((r) => r.id));
  const rows = (chR.data ?? []) as {
    id: string; name: string; topic: string | null; visibility: Visibility;
    department_id: string | null; is_archived: boolean;
  }[];
  const depts = await departmentNames(s, rows.map((r) => r.department_id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    topic: r.topic,
    visibility: r.visibility,
    department_name: r.department_id ? depts.get(r.department_id) ?? null : null,
    is_archived: r.is_archived,
    is_member: mine.has(r.id),
  }));
}

/** One conversation and its members, or null when the caller may not see it. */
export async function getConversation(id: string): Promise<ConversationDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const s = await createClient();
  const me = await myId();
  // 0751's columns, with 0737's as the fallback: the code lands with a pull and
  // the columns when someone applies 0751, and every conversation must keep
  // opening in between (42703 = undefined column). The fallback rows simply
  // lack description / pin / level, which the types allow.
  const conversationRead = (cols: string) => s.from("comm_conversations").select(cols).eq("id", id).maybeSingle();
  const membersRead = (cols: string) => s.from("comm_members").select(cols).eq("conversation_id", id).order("joined_at");
  const [conv0, mem0, manageR] = await Promise.all([
    conversationRead("id, kind, name, topic, description, visibility, department_id, is_archived, archived_at, created_at"),
    membersRead("user_id, role, joined_at, removed_at, added_by, muted, last_read_at, pinned_at, notify_level"),
    s.rpc("comm_can_manage", { p_conv: id }),
  ]);
  let convR = conv0;
  let memR = mem0;
  if (convR.error?.code === "42703") convR = await conversationRead("id, kind, name, topic, visibility, department_id, is_archived, created_at");
  if (memR.error?.code === "42703") memR = await membersRead("user_id, role, joined_at, removed_at, added_by, muted, last_read_at");
  if (convR.error) fail("the conversation", convR.error);
  if (!convR.data) return null;
  if (memR.error) fail("members", memR.error);
  if (manageR.error) fail("the conversation's permissions", manageR.error);

  const raw = convR.data as unknown as Omit<ConversationDetail, "title" | "members" | "me" | "can_manage" | "department_name" | "description" | "archived_at"> &
    Partial<Pick<ConversationDetail, "description" | "archived_at">>;
  const conv = { ...raw, description: raw.description ?? null, archived_at: raw.archived_at ?? null };
  const rows = (memR.data ?? []) as unknown as (Omit<CommMember, "full_name" | "added_by_name"> & {
    muted: boolean;
    last_read_at: string | null;
    pinned_at: string | null;
    notify_level: "all" | "mentions" | "none";
  })[];
  const [names, depts] = await Promise.all([
    // The adders too: a channel's "Roja added Ramesh" notes name them, and an
    // adder may since have left (0737's added_by).
    resolveNames(s, [...new Set([...rows.map((r) => r.user_id), ...rows.flatMap((r) => (r.added_by ? [r.added_by] : []))])]),
    departmentNames(s, [conv.department_id]),
  ]);
  const members: CommMember[] = rows.map((r) => ({
    user_id: r.user_id,
    role: r.role,
    joined_at: r.joined_at,
    removed_at: r.removed_at,
    full_name: names.get(r.user_id) ?? null,
    last_read_at: r.last_read_at ?? null,
    added_by: r.added_by ?? null,
    added_by_name: r.added_by ? (names.get(r.added_by) ?? null) : null,
  }));
  // 0759: who the composer may offer for @mention. Before 0759 the read fails
  // and everyone stays offered, as before (the server still drops a mention of
  // anyone it should not).
  const { data: mentionable, error: mentionErr } = await s.rpc("comm_mentionable_members", { p_conv: id });
  if (!mentionErr) {
    const ok = new Set((mentionable ?? []) as string[]);
    for (const m of members) m.mentionable = ok.has(m.user_id);
  }
  const mine = rows.find((r) => r.user_id === me);
  const others = members.filter((m) => m.user_id !== me && !m.removed_at).map((m) => m.full_name);
  // 0764: the caller's own Favourite / Archived flags, for the chat's ⋮ menu.
  // Read on their own so a database without 0764 (42703) still opens the chat.
  let myFlags = { favorite: false, archived: false };
  if (mine && me) {
    const f = await s.from("comm_members").select("favorite_at, archived_at").eq("conversation_id", id).eq("user_id", me).maybeSingle();
    if (f.error && f.error.code !== "42703") fail("your chat settings", f.error);
    const row = f.data as { favorite_at: string | null; archived_at: string | null } | null;
    if (row) myFlags = { favorite: !!row.favorite_at, archived: !!row.archived_at };
  }

  return {
    ...conv,
    department_name: conv.department_id ? depts.get(conv.department_id) ?? null : null,
    title: conversationTitle(conv, others),
    members,
    me: mine
      ? {
          role: mine.role,
          muted: mine.muted,
          last_read_at: mine.last_read_at,
          active: !mine.removed_at,
          pinned_at: mine.pinned_at ?? null,
          notify_level: mine.notify_level ?? (mine.muted ? "mentions" : "all"),
          favorite: myFlags.favorite,
          archived: myFlags.archived,
        }
      : null,
    can_manage: manageR.data === true,
    ...(await communityOfConversation(s, id)),
  };
}

/** 0775: the community a conversation belongs to, and whether the caller is
 *  one of its admins. Nothing before 0775 is applied (42703 / missing RPC). */
async function communityOfConversation(
  s: Sb,
  id: string,
): Promise<Pick<ConversationDetail, "community" | "is_announcement">> {
  const { data, error } = await s.from("comm_conversations").select("community_id, is_announcement").eq("id", id).maybeSingle();
  if (error) {
    if (error.code === "42703") return { community: null, is_announcement: false };
    fail("the conversation's community", error);
  }
  const row = data as { community_id: string | null; is_announcement: boolean } | null;
  if (!row?.community_id) return { community: null, is_announcement: row?.is_announcement ?? false };
  const [comm, admin] = await Promise.all([
    s.from("comm_communities").select("id, name").eq("id", row.community_id).maybeSingle(),
    s.rpc("comm_is_community_admin", { p_community: row.community_id }),
  ]);
  if (comm.error) fail("the community", comm.error);
  if (admin.error) fail("community permissions", admin.error);
  // Not a member of the community (RLS hides it): the conversation still opens.
  const c = comm.data as { id: string; name: string } | null;
  return {
    community: c ? { id: c.id, name: c.name, is_admin: admin.data === true } : null,
    is_announcement: row.is_announcement,
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// The FK column names the embed (AGENTS.md "A second FK breaks every existing
// embed"): each child table has one FK to comm_messages today, and naming it
// keeps that true the day one gains a second.
const MESSAGE_SELECT =
  "id, conversation_id, author_id, kind, body, parent_id, reply_count, last_reply_at, edited_at, deleted_at, created_at, " +
  "comm_attachments!message_id(id, file_name, storage_path, mime_type, size_bytes), " +
  "comm_reactions!message_id(emoji, user_id, created_at), " +
  "comm_pins!message_id(message_id)";

type RawMessage = Omit<CommMessage, "author_name" | "pinned" | "saved" | "attachments" | "reactions"> & {
  comm_attachments: CommMessage["attachments"] | null;
  comm_reactions: { emoji: string; user_id: string; created_at: string }[] | null;
  comm_pins: { message_id: string } | { message_id: string }[] | null;
};

/**
 * Raw rows → screen rows: names, reactions folded, pins and saves marked.
 *
 * 0807: a message the caller chose "Delete for me" on is DROPPED here, so every
 * list that hydrates (the chat, threads, search, saved) stops showing it to that
 * one person. `keep` names a row that must survive anyway — a thread's parent,
 * which getThread destructures. Before 0807 is applied the table is missing and
 * nothing is hidden.
 */
async function hydrate(s: Sb, rows: RawMessage[], me: string | null, keep?: string): Promise<CommMessage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [names, savedR, hiddenR, fwdR] = await Promise.all([
    resolveNames(s, rows.map((r) => r.author_id)),
    me
      ? s.from("comm_saved").select("message_id").eq("user_id", me).in("message_id", ids)
      : Promise.resolve({ data: [], error: null }),
    me
      ? s.from("comm_hidden").select("message_id").eq("user_id", me).in("message_id", ids)
      : Promise.resolve({ data: [], error: null }),
    // 0812's mark, asked separately rather than in MESSAGE_SELECT so that every
    // message list keeps loading before the column exists (42703 → none marked).
    s.from("comm_messages").select("id").in("id", ids).eq("forwarded", true),
  ]);
  const forwarded = new Set(fwdR.error ? [] : ((fwdR.data ?? []) as { id: string }[]).map((r) => r.id));
  if (savedR.error) fail("saved messages", savedR.error);
  const hiddenMissing = !!hiddenR.error && (hiddenR.error.code === "42P01" || hiddenR.error.code === "PGRST205");
  if (hiddenR.error && !hiddenMissing) fail("hidden messages", hiddenR.error);
  const saved = new Set(((savedR.data ?? []) as { message_id: string }[]).map((r) => r.message_id));
  const hidden = new Set((hiddenMissing ? [] : ((hiddenR.data ?? []) as { message_id: string }[])).map((r) => r.message_id));
  if (hidden.size > 0) rows = rows.filter((r) => r.id === keep || !hidden.has(r.id));
  const cards = await cardData(s, rows, me);

  return rows.map((r) => {
    const pins = r.comm_pins;
    return {
      id: r.id,
      conversation_id: r.conversation_id,
      author_id: r.author_id,
      author_name: r.author_id ? names.get(r.author_id) ?? null : null,
      kind: r.kind,
      body: r.body,
      parent_id: r.parent_id,
      reply_count: r.reply_count,
      last_reply_at: r.last_reply_at,
      edited_at: r.edited_at,
      deleted_at: r.deleted_at,
      created_at: r.created_at,
      pinned: Array.isArray(pins) ? pins.length > 0 : !!pins,
      saved: saved.has(r.id),
      attachments: r.comm_attachments ?? [],
      forwarded: forwarded.has(r.id),
      reactions: foldReactions(r.comm_reactions ?? [], me),
      poll: cards.polls.get(r.id) ?? null,
      event: cards.events.get(r.id) ?? null,
    };
  });
}

/**
 * 0776: the poll / event behind each `<poll>` / `<event>` message on a page,
 * with counts and the caller's own vote / answer. Asked only when the page
 * holds one (lib/comms/cards.ts, "WHY A TOKEN"). Before 0776 is applied the
 * tables do not exist and the messages draw as text.
 */
async function cardData(
  s: Sb,
  rows: RawMessage[],
  me: string | null,
): Promise<{ polls: Map<string, PollData>; events: Map<string, EventData> }> {
  const polls = new Map<string, PollData>();
  const events = new Map<string, EventData>();
  const pollIds = rows.filter((r) => !r.deleted_at && cardKind(r.body) === "poll").map((r) => r.id);
  const eventIds = rows.filter((r) => !r.deleted_at && cardKind(r.body) === "event").map((r) => r.id);
  const missing = (e: { code?: string | null } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");
  if (pollIds.length) {
    const [pR, vR] = await Promise.all([
      s.from("comm_polls").select("message_id, question, options, multi").in("message_id", pollIds),
      s.from("comm_poll_votes").select("message_id, option_idx, user_id").in("message_id", pollIds),
    ]);
    if (!missing(pR.error) && !missing(vR.error)) {
      if (pR.error) fail("polls", pR.error);
      if (vR.error) fail("poll votes", vR.error);
      const votes = (vR.data ?? []) as { message_id: string; option_idx: number; user_id: string }[];
      for (const p of (pR.data ?? []) as { message_id: string; question: string; options: string[]; multi: boolean }[]) {
        const mineV = votes.filter((v) => v.message_id === p.message_id);
        polls.set(p.message_id, {
          question: p.question,
          multi: p.multi,
          voters: new Set(mineV.map((v) => v.user_id)).size,
          options: p.options.map((text, i) => ({
            text,
            votes: mineV.filter((v) => v.option_idx === i).length,
            mine: mineV.some((v) => v.option_idx === i && v.user_id === me),
          })),
        });
      }
    }
  }
  if (eventIds.length) {
    const [eR, aR] = await Promise.all([
      s.from("comm_events").select("message_id, name, description, event_date, event_time, location").in("message_id", eventIds),
      s.from("comm_event_rsvps").select("message_id, user_id, answer").in("message_id", eventIds),
    ]);
    if (!missing(eR.error) && !missing(aR.error)) {
      if (eR.error) fail("events", eR.error);
      if (aR.error) fail("event answers", aR.error);
      const answers = (aR.data ?? []) as { message_id: string; user_id: string; answer: RsvpAnswer }[];
      for (const e of (eR.data ?? []) as {
        message_id: string; name: string; description: string | null; event_date: string; event_time: string | null; location: string | null;
      }[]) {
        const mineA = answers.filter((a) => a.message_id === e.message_id);
        events.set(e.message_id, {
          name: e.name,
          description: e.description,
          event_date: e.event_date,
          event_time: e.event_time ? e.event_time.slice(0, 5) : null,
          location: e.location,
          going: mineA.filter((a) => a.answer === "going").length,
          maybe: mineA.filter((a) => a.answer === "maybe").length,
          no: mineA.filter((a) => a.answer === "no").length,
          mine: mineA.find((a) => a.user_id === me)?.answer ?? null,
        });
      }
    }
  }
  return { polls, events };
}

/**
 * One page of a conversation's top-level messages, KEYSET-paged on
 * (created_at, id) — never OFFSET, which skips or repeats rows while new
 * messages arrive at the top. `before` is the `next_cursor` of the page below.
 */
export async function getMessages(
  conversationId: string,
  before?: string | null,
  limit: number = MESSAGE_PAGE,
): Promise<MessagePage> {
  if (!UUID_RE.test(conversationId)) return { messages: [], next_cursor: null };
  const size = Math.min(Math.max(limit, 1), 100);
  const cur = decodeCursor(before);
  if (before && !cur) return { messages: [], next_cursor: null };

  const s = await createClient();
  const me = await myId();
  let q = s
    .from("comm_messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);
  if (cur) {
    // Both values were shape-checked by decodeCursor before they reach the filter.
    q = q.or(`created_at.lt."${cur.created_at}",and(created_at.eq."${cur.created_at}",id.lt.${cur.id})`);
  }
  const { data, error } = await q;
  if (error) fail("messages", error);

  const rows = (data ?? []) as unknown as RawMessage[];
  const more = rows.length > size;
  const page = more ? rows.slice(0, size) : rows;
  const last = page[page.length - 1];
  const messages = (await hydrate(s, page, me)).reverse();
  return { messages, next_cursor: more && last ? encodeCursor(last.created_at, last.id) : null };
}

/**
 * Specific messages of one conversation, re-read after a Realtime UPDATE names
 * them (a reaction, an edit, a delete) — so a change to a message the reader
 * scrolled back to arrives too, not only one on the newest page. RLS decides,
 * as everywhere: an id the caller may not read simply does not come back.
 */
export async function getMessagesByIds(conversationId: string, ids: string[]): Promise<CommMessage[]> {
  const wanted = Array.from(new Set(ids.filter((v) => UUID_RE.test(v)))).slice(0, 100);
  if (!UUID_RE.test(conversationId) || wanted.length === 0) return [];
  const s = await createClient();
  const me = await myId();
  const { data, error } = await s
    .from("comm_messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .in("id", wanted);
  if (error) fail("messages", error);
  return hydrate(s, (data ?? []) as unknown as RawMessage[], me);
}

/**
 * PULSE'S THREADS SECTION (0811, user 2026-11-05): threads the caller started
 * or replied in, newest reply first. Read through the ordinary comm_messages
 * RLS, so a thread in a chat the caller has left or cannot read never appears.
 *
 * Unread = replies BY OTHERS newer than the caller last opened the thread
 * (comm_thread_seen), counted. With no seen row, the caller's own newest reply
 * in it stands in (they were there then); a thread they only started and never
 * opened counts every reply. Before 0811 is applied that table is missing and
 * nothing reads unread.
 */
// created-by: exempt -- a feed of threads for the list pane, not a listing of records; it has no Created columns
export async function listMyThreads(limit = 30): Promise<ThreadSummary[]> {
  const me = await myId();
  if (!me) return [];
  const s = await createClient();
  const { data: mine, error: mErr } = await s
    .from("comm_messages")
    .select("parent_id")
    .eq("author_id", me)
    .not("parent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (mErr) fail("your threads", mErr);
  const repliedIn = [...new Set(((mine ?? []) as { parent_id: string }[]).map((r) => r.parent_id))];
  const or = repliedIn.length > 0 ? `author_id.eq.${me},id.in.(${repliedIn.join(",")})` : `author_id.eq.${me}`;
  const { data: parents, error: pErr } = await s
    .from("comm_messages")
    .select("id, conversation_id, body, reply_count, last_reply_at, deleted_at")
    .is("parent_id", null)
    .gt("reply_count", 0)
    .not("last_reply_at", "is", null)
    .or(or)
    .order("last_reply_at", { ascending: false })
    .limit(limit);
  if (pErr) fail("your threads", pErr);
  type P = { id: string; conversation_id: string; body: string | null; reply_count: number; last_reply_at: string; deleted_at: string | null };
  const rows = (parents ?? []) as P[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [lastR, seenR, hiddenR] = await Promise.all([
    s
      .from("comm_messages")
      .select("parent_id, author_id, created_at")
      .in("parent_id", ids)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1000),
    s.from("comm_thread_seen").select("parent_id, seen_at").eq("user_id", me).in("parent_id", ids),
    s.from("comm_hidden").select("message_id").eq("user_id", me).in("message_id", ids),
  ]);
  if (lastR.error) fail("your threads", lastR.error);
  const missing = (e: { code?: string | null } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");
  if (seenR.error && !missing(seenR.error)) fail("your threads", seenR.error);
  if (hiddenR.error && !missing(hiddenR.error)) fail("your threads", hiddenR.error);
  const seenMissing = missing(seenR.error);

  const replyRows = (lastR.data ?? []) as { parent_id: string; author_id: string | null; created_at: string }[];
  const lastBy = new Map<string, string | null>();
  const myLast = new Map<string, string>();
  for (const r of replyRows) {
    if (!lastBy.has(r.parent_id)) lastBy.set(r.parent_id, r.author_id);
    if (r.author_id === me && !myLast.has(r.parent_id)) myLast.set(r.parent_id, r.created_at);
  }
  const seen = new Map(((seenMissing ? [] : seenR.data) ?? []).map((r) => [(r as { parent_id: string }).parent_id, (r as { seen_at: string }).seen_at]));
  const unreadOf = new Map<string, number>();
  if (!seenMissing) {
    for (const r of replyRows) {
      if (r.author_id === me) continue;
      const since = seen.get(r.parent_id) ?? myLast.get(r.parent_id);
      if (since && new Date(r.created_at) <= new Date(since)) continue;
      unreadOf.set(r.parent_id, (unreadOf.get(r.parent_id) ?? 0) + 1);
    }
  }
  const hidden = new Set(((missing(hiddenR.error) ? [] : hiddenR.data) ?? []).map((r) => (r as { message_id: string }).message_id));
  const names = await resolveNames(s, [...lastBy.values(), ...rows.flatMap((r) => mentionIds(r.body))]);

  return rows
    .filter((r) => !hidden.has(r.id))
    .map((r) => {
      const lastAuthor = lastBy.get(r.id) ?? null;
      const unreadCount = unreadOf.get(r.id) ?? 0;
      return {
        id: r.id,
        conversation_id: r.conversation_id,
        preview: r.deleted_at ? "This message was deleted" : previewText(r.body, names) || "Attachment",
        reply_count: r.reply_count,
        last_reply_at: r.last_reply_at,
        last_reply_author_id: lastAuthor,
        last_reply_author_name: lastAuthor === me ? "You" : lastAuthor ? names.get(lastAuthor) ?? null : null,
        unread: unreadCount > 0,
        unread_count: unreadCount,
      };
    });
}

/** A thread: its first message and every reply, oldest first. */
export async function getThread(parentId: string): Promise<{ parent: CommMessage; replies: CommMessage[] } | null> {
  if (!UUID_RE.test(parentId)) return null;
  const s = await createClient();
  const me = await myId();
  const [pR, rR] = await Promise.all([
    s.from("comm_messages").select(MESSAGE_SELECT).eq("id", parentId).maybeSingle(),
    s
      .from("comm_messages")
      .select(MESSAGE_SELECT)
      .eq("parent_id", parentId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(500),
  ]);
  if (pR.error) fail("the thread", pR.error);
  if (!pR.data) return null;
  if (rR.error) fail("replies", rR.error);
  const [parent, ...replies] = await hydrate(
    s,
    [pR.data as unknown as RawMessage, ...((rR.data ?? []) as unknown as RawMessage[])],
    me,
    parentId,
  );
  return { parent, replies };
}

export async function getPinned(conversationId: string): Promise<CommMessage[]> {
  if (!UUID_RE.test(conversationId)) return [];
  const s = await createClient();
  const me = await myId();
  const { data: pins, error } = await s
    .from("comm_pins")
    .select("message_id, pinned_at")
    .eq("conversation_id", conversationId)
    .order("pinned_at", { ascending: false })
    .limit(100);
  if (error) fail("pinned messages", error);
  const ids = ((pins ?? []) as { message_id: string }[]).map((p) => p.message_id);
  if (ids.length === 0) return [];
  const { data, error: mErr } = await s.from("comm_messages").select(MESSAGE_SELECT).in("id", ids);
  if (mErr) fail("pinned messages", mErr);
  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = ((data ?? []) as unknown as RawMessage[]).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return hydrate(s, rows, me);
}

async function withTitles(s: Sb, messages: CommMessage[], me: string | null): Promise<MessageHit[]> {
  const convIds = Array.from(new Set(messages.map((m) => m.conversation_id)));
  if (convIds.length === 0) return [];
  const { data, error } = await s.from("comm_conversations").select("id, kind, name").in("id", convIds);
  if (error) fail("conversations", error);
  const convs = (data ?? []) as { id: string; kind: ConversationKind; name: string | null }[];
  const titles = await titlesFor(s, convs, me);
  const kinds = new Map(convs.map((c) => [c.id, c.kind]));
  return messages.map((m) => ({
    message: m,
    conversation_title: titles.get(m.conversation_id) ?? "Conversation",
    conversation_kind: kinds.get(m.conversation_id),
  }));
}

// ---------------------------------------------------------------------------
// Search (0762)
// ---------------------------------------------------------------------------

export type SearchOutcome = {
  hits: MessageHit[];
  next: string | null;
  /** Operator values that could not be used, in the operator's words. */
  problems: string[];
  terms: string[];
  /** Names the operators resolved to, for the active-filter chips. */
  resolved: { author: { id: string; name: string } | null; conversation: { id: string; name: string } | null };
};

/**
 * `from:name` → one person the CALLER's directory shows (comm_directory, which
 * already hides the deactivated). Exact name or employee code first; a single
 * partial match next; anything else is reported, never guessed.
 */
async function resolvePerson(s: Sb, name: string): Promise<{ id: string; name: string } | string> {
  const { data, error } = await s.rpc("comm_directory", { p_q: name, p_limit: 10 });
  if (error) return `from:${name} could not be looked up.`;
  const rows = (data ?? []) as DirectoryPerson[];
  const n = name.toLowerCase();
  const exact = rows.filter((p) => (p.full_name ?? "").toLowerCase() === n || (p.employee_code ?? "").toLowerCase() === n);
  const pick = exact.length === 1 ? exact[0] : exact.length === 0 && rows.length === 1 ? rows[0] : null;
  if (pick) return { id: pick.id, name: pick.full_name ?? name };
  if (rows.length === 0) return `No one called "${name}" — check the spelling.`;
  return `from:${name} matches ${rows.length} people (${rows.slice(0, 3).map((p) => p.full_name).join(", ")}…). Use the full name in quotes, e.g. from:"${rows[0].full_name}".`;
}

/**
 * `in:name` → one channel the CALLER can see (comm_discover_channels: public
 * ones and private ones they are in — a private channel they are not in is
 * "not found", exactly like one that does not exist).
 */
async function resolveChannel(s: Sb, name: string): Promise<{ id: string; name: string } | string> {
  const n = name.toLowerCase().replace(/^#/, "");
  for (const scope of ["active", "archived"] as const) {
    const { data, error } = await s.rpc("comm_discover_channels", { p_q: n, p_scope: scope, p_limit: 50, p_offset: 0 });
    if (error) return `in:${name} could not be looked up.`;
    const hit = ((data ?? []) as { id: string; name: string }[]).find((c) => c.name.toLowerCase() === n);
    if (hit) return { id: hit.id, name: hit.name };
  }
  return `No channel you can see is called #${n}.`;
}

/**
 * Message search (0762). The query's operators are resolved into ids through
 * what the caller may see; the filter bar's values arrive as ids already.
 * Both NARROW the search (an operator and a filter that disagree find
 * nothing, and say why). comm_search_messages runs as the caller, so RLS
 * decides every row; this function then loads the page's messages in ONE
 * select and their titles in one more — never a query per result.
 */
export async function searchHuddle(input: SearchInput & { cursor?: string | null }): Promise<SearchOutcome> {
  const s = await createClient();
  const me = await myId();
  const parsed = parseQuery(input.q ?? "");
  const problems = [...parsed.problems];
  const terms = searchTerms(parsed.text);
  const empty: SearchOutcome = { hits: [], next: null, problems, terms, resolved: { author: null, conversation: null } };

  let author = input.author ?? null;
  let authorName: { id: string; name: string } | null = null;
  for (const f of parsed.from.slice(0, 1)) {
    const r = await resolvePerson(s, f);
    if (typeof r === "string") problems.push(r);
    else if (author && author !== r.id) problems.push(`from:${f} and the Sender filter name different people.`);
    else {
      author = r.id;
      authorName = r;
    }
  }
  let conversation = input.conversation ?? null;
  let convName: { id: string; name: string } | null = null;
  for (const c of parsed.in.slice(0, 1)) {
    const r = await resolveChannel(s, c);
    if (typeof r === "string") problems.push(r);
    else if (conversation && conversation !== r.id) problems.push(`in:${c} and the Channel filter name different channels.`);
    else {
      conversation = r.id;
      convName = r;
    }
  }
  if (parsed.from.length > 1 || parsed.in.length > 1) problems.push("Use one from: and one in: at a time.");
  // An operator that could not be resolved must not quietly widen the search.
  if (problems.length > 0) return { ...empty, problems };

  const later = (a: string | null | undefined, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);
  const earlier = (a: string | null | undefined, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b);
  const fromDay = later(input.fromDay, parsed.fromDay);
  const toDay = earlier(input.toDay, parsed.toDay);
  const kind = parsed.thread ? "thread" : input.kind ?? null;
  const cur = decodeSearchCursor(input.cursor ?? null);

  const { data, error } = await s.rpc("comm_search_messages", {
    p_text: parsed.text || null,
    p_by_person: author,
    p_conversation: conversation,
    p_from_day: fromDay,
    p_to_day: toDay,
    p_has_file: !!(input.hasFile || parsed.hasFile),
    p_kind: kind,
    p_sort: input.sort ?? "relevance",
    p_after_rank: cur?.r ?? null,
    p_after_at: cur?.t ?? null,
    p_after_id: cur?.i ?? null,
    p_limit: SEARCH_PAGE,
  });
  if (error) {
    if (error.code === "22023" || error.code === "42501") return { ...empty, problems: [error.message] };
    fail("search results", error);
  }
  const rows = (data ?? []) as { id: string; created_at: string; rank: number }[];
  const page = rows.slice(0, SEARCH_PAGE);
  const last = page[page.length - 1];
  const next =
    rows.length > SEARCH_PAGE && last
      ? encodeSearchCursor({ r: (input.sort ?? "relevance") === "relevance" && parsed.text ? last.rank : null, t: last.created_at, i: last.id })
      : null;
  if (page.length === 0) return { ...empty, resolved: { author: authorName, conversation: convName } };

  const { data: msgs, error: mErr } = await s.from("comm_messages").select(MESSAGE_SELECT).in("id", page.map((r) => r.id));
  if (mErr) fail("search results", mErr);
  const order = new Map(page.map((r, i) => [r.id, i]));
  const ordered = ((msgs ?? []) as unknown as RawMessage[]).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const hits = await withTitles(s, await hydrate(s, ordered, me), me);
  return { hits, next, problems, terms, resolved: { author: authorName, conversation: convName } };
}

// ---------------------------------------------------------------------------
// Saved (0763)
// ---------------------------------------------------------------------------

export const SAVED_PAGE = 30;

/** One saved row as the Saved page shows it. `hit` is null when the message
 *  is no longer readable by the caller: nothing about it is returned. */
export type SavedItem = { message_id: string; saved_at: string; hit: MessageHit | null };

export type SavedQuery = {
  q?: string | null;
  conversation?: string | null;
  kind?: "channel" | "direct" | "group" | "thread" | null;
  hasFile?: boolean;
  cursor?: string | null;
};

const SAVED_CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f-]{36})$/i;
function encodeSavedCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}
function decodeSavedCursor(c: string | null | undefined): { at: string; id: string } | null {
  if (!c || c.length > 200) return null;
  try {
    const m = SAVED_CURSOR_RE.exec(Buffer.from(c, "base64url").toString("utf8"));
    return m && UUID_RE.test(m[2]) ? { at: m[1], id: m[2] } : null;
  } catch {
    return null;
  }
}

/**
 * The caller's saved messages, newest save first, a page at a time (0763).
 * comm_my_saved runs AS THE CALLER, so only their own rows come back and a
 * message they can no longer read comes back as unavailable — with nothing
 * about it. The available messages then load in ONE select, with names and
 * conversation titles in one call each: never a query per saved item.
 */
export async function getSavedPage(query: SavedQuery = {}): Promise<{ items: SavedItem[]; next: string | null }> {
  const s = await createClient();
  const me = await myId();
  if (!me) return { items: [], next: null };
  const cur = decodeSavedCursor(query.cursor);
  const { data, error } = await s.rpc("comm_my_saved", {
    p_text: query.q?.trim() || null,
    p_conversation: query.conversation && UUID_RE.test(query.conversation) ? query.conversation : null,
    p_kind: query.kind ?? null,
    p_has_file: !!query.hasFile,
    p_before_at: cur?.at ?? null,
    p_before_id: cur?.id ?? null,
    p_limit: SAVED_PAGE,
  });
  if (error) fail("saved messages", error);
  const rows = (data ?? []) as { message_id: string; saved_at: string; available: boolean }[];
  const page = rows.slice(0, SAVED_PAGE);
  const last = page[page.length - 1];
  const next = rows.length > SAVED_PAGE && last ? encodeSavedCursor(last.saved_at, last.message_id) : null;

  const ids = page.filter((r) => r.available).map((r) => r.message_id);
  let hits = new Map<string, MessageHit>();
  if (ids.length > 0) {
    const { data: msgs, error: mErr } = await s.from("comm_messages").select(MESSAGE_SELECT).in("id", ids);
    if (mErr) fail("saved messages", mErr);
    const list = await withTitles(s, await hydrate(s, (msgs ?? []) as unknown as RawMessage[], me), me);
    hits = new Map(list.map((h) => [h.message.id, h]));
  }
  return {
    items: page.map((r) => ({ message_id: r.message_id, saved_at: r.saved_at, hit: hits.get(r.message_id) ?? null })),
    next,
  };
}

// ---------------------------------------------------------------------------
// Mentions (user 2026-11-06, artifact "Pulse: fixing the Mentions shortcut",
// option A). The shortcut used to open /comms/notifications — every alert —
// while its badge counted only @mentions.
// ---------------------------------------------------------------------------

export const MENTIONS_PAGE = 30;

/** One @mention of the caller. `unread` uses the same test as the chat list's
 *  `mention_count` (0764): the message is newer than the caller's read point in
 *  that chat — so the page's unread rows and the shortcut's badge agree. */
export type MentionItem = { hit: MessageHit; unread: boolean };

/**
 * Messages that @mention the caller, newest first, a page at a time.
 *
 * `unreadOnly` cannot be a SQL filter — "unread" is per-chat (each chat has its
 * own read point) and PostgREST cannot compare two tables' columns. So the
 * candidate window is bounded instead: nothing older than the EARLIEST read
 * point among the caller's chats can be unread, and only that window is read
 * (capped at UNREAD_SCAN rows), then tested per chat.
 *
 * Deleted messages are left out, as `mention_count` leaves them out. Reads run
 * as the caller, so RLS (comm_mentions_read → comm_message_visible) drops any
 * message they can no longer read.
 */
const UNREAD_SCAN = 500;
export async function getMentionsPage(query: { cursor?: string | null; unreadOnly?: boolean } = {}): Promise<{
  items: MentionItem[];
  next: string | null;
}> {
  const s = await createClient();
  const me = await myId();
  if (!me) return { items: [], next: null };

  const { data: memRows, error: memErr } = await s
    .from("comm_members")
    .select("conversation_id, last_read_at, joined_at")
    .eq("user_id", me)
    .is("removed_at", null);
  if (memErr) fail("mentions", memErr);
  const readPoint = new Map(
    ((memRows ?? []) as { conversation_id: string; last_read_at: string | null; joined_at: string }[]).map((m) => [
      m.conversation_id,
      m.last_read_at ?? m.joined_at,
    ]),
  );
  const isUnread = (m: { conversation_id: string; created_at: string }) => {
    const at = readPoint.get(m.conversation_id);
    return !!at && Date.parse(m.created_at) > Date.parse(at);
  };

  let q = s
    .from("comm_mentions")
    .select("message_id, created_at")
    .eq("user_id", me)
    .order("created_at", { ascending: false })
    .order("message_id", { ascending: false });

  if (query.unreadOnly) {
    const points = Array.from(readPoint.values()).sort();
    if (points.length === 0) return { items: [], next: null };
    q = q.gt("created_at", points[0]).limit(UNREAD_SCAN);
  } else {
    const cur = decodeSavedCursor(query.cursor);
    // Quoted: a timestamp carries ":" and "+", which PostgREST's or() grammar reads otherwise.
    if (cur) q = q.or(`created_at.lt."${cur.at}",and(created_at.eq."${cur.at}",message_id.lt.${cur.id})`);
    q = q.limit(MENTIONS_PAGE + 1);
  }
  const { data, error } = await q;
  if (error) fail("mentions", error);
  const rows = (data ?? []) as { message_id: string; created_at: string }[];
  const page = query.unreadOnly ? rows : rows.slice(0, MENTIONS_PAGE);
  const last = page[page.length - 1];
  const next = !query.unreadOnly && rows.length > MENTIONS_PAGE && last ? encodeSavedCursor(last.created_at, last.message_id) : null;

  const ids = page.map((r) => r.message_id);
  if (ids.length === 0) return { items: [], next };
  const { data: msgs, error: mErr } = await s.from("comm_messages").select(MESSAGE_SELECT).in("id", ids).is("deleted_at", null);
  if (mErr) fail("mentions", mErr);
  const order = new Map(ids.map((id, i) => [id, i]));
  const raw = ((msgs ?? []) as unknown as RawMessage[]).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const hits = await withTitles(s, await hydrate(s, raw, me), me);
  const items = hits
    .map((hit) => ({ hit, unread: isUnread(hit.message) }))
    .filter((it) => !query.unreadOnly || it.unread);
  return { items, next };
}

/**
 * The caller's saved messages, newest save first. A bookmark whose message the
 * caller can no longer read — its private channel was made inaccessible, or
 * the conversation was deleted — drops out through RLS rather than erroring.
 */
export async function getSaved(): Promise<MessageHit[]> {
  const s = await createClient();
  const me = await myId();
  if (!me) return [];
  const { data: saved, error } = await s
    .from("comm_saved")
    .select("message_id, saved_at")
    .eq("user_id", me)
    .order("saved_at", { ascending: false })
    .limit(200);
  if (error) fail("saved messages", error);
  const ids = ((saved ?? []) as { message_id: string }[]).map((r) => r.message_id);
  if (ids.length === 0) return [];
  const { data, error: mErr } = await s.from("comm_messages").select(MESSAGE_SELECT).in("id", ids);
  if (mErr) fail("saved messages", mErr);
  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = ((data ?? []) as unknown as RawMessage[]).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return withTitles(s, await hydrate(s, rows, me), me);
}

/**
 * Text search over every message the caller can read — RLS scopes it, so a
 * hit can never come from a conversation they are not in.
 *
 * INTERIM: `ilike` with no index. Correct, and fine while the table is young;
 * the Search phase adds a full-text index once real query patterns exist
 * (spec §12: "add indexes after examining actual query patterns").
 */
export async function searchMessages(query: string, limit = 50): Promise<MessageHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const s = await createClient();
  const me = await myId();
  const pat = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await s
    .from("comm_messages")
    .select(MESSAGE_SELECT)
    .ilike("body", pat)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) fail("search results", error);
  return withTitles(s, await hydrate(s, (data ?? []) as unknown as RawMessage[], me), me);
}

/**
 * Departments a channel may be linked to. Switched-off ones are left out — a
 * switched-off master row is not offered for selection (AGENTS.md "Disabled
 * rows"); a channel already linked to one still shows its name.
 *
 * The flag is `inactive` (0299 renamed 0259's `blocked`), read through
 * `isInactive()` so the spelling is never guessed again — the live end-to-end
 * run caught this file and 0737 both reading `blocked` (fixed by 0749).
 */
export async function listDepartments(): Promise<{ id: string; name: string }[]> {
  const s = await createClient();
  const { data, error } = await s.from("departments").select("id, name, inactive").order("name");
  if (error) fail("departments", error);
  return ((data ?? []) as { id: string; name: string; inactive: boolean | null }[])
    .filter((d) => !isInactive(d))
    .map(({ id, name }) => ({ id, name }));
}

/** The people picker (comm_directory: name, code, designation, department — nothing more). */
export async function searchDirectory(query: string | null, limit = 20): Promise<DirectoryPerson[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_directory", { p_q: query?.trim() || null, p_limit: limit });
  if (error) fail("people", error);
  return (data ?? []) as DirectoryPerson[];
}
