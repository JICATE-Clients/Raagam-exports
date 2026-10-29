import { z } from "zod";
import { isAllowedEmoji } from "./emoji";

// ============================================================================
// Communication Hub — shared vocabulary (0737, doc/slack.md/slack).
//
// Direct messages, groups and channels between ERP LOGINS (`profiles.id`).
// Every write is a SECURITY DEFINER RPC that takes the actor from the session;
// nothing in this file names a sender, and nothing a browser sends could.
//
// Pure: no server import, so the screens, the server actions and
// scripts/check-comms.mts all read the same rules.
// ============================================================================

export const CONVERSATION_KINDS = ["direct", "group", "channel"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** The private bucket 0737 creates. Never `order-community-files` (0458's). */
export const COMM_BUCKET = "comm-files";

/** Mirrors `chk_comm_msg_body_len` and the send RPC. */
export const MESSAGE_MAX = 8000;
/** Mirrors the bucket's `file_size_limit` and `comm_attachments.size_bytes`. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 10;
export const MESSAGE_PAGE = 40;

/**
 * The bucket's allowlist — the SAME list as `comm_allowed_mime()` and the
 * bucket row in 0737. scripts/check-comms.mts reads the migration and fails if
 * the three ever disagree: a type the browser accepts and the bucket refuses is
 * an upload that dies after the operator picked the file.
 */
export const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

// ---------------------------------------------------------------------------
// Rows, as the services hand them to a screen
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  name: string | null;
  topic: string | null;
  visibility: Visibility;
  department_id: string | null;
  department_name: string | null;
  is_archived: boolean;
  last_message_at: string | null;
  created_at: string;
  my_role: MemberRole;
  muted: boolean;
  last_read_at: string | null;
  unread_count: number;
  mention_count: number;
  /** Direct only: the other person. */
  other_user_id: string | null;
  member_count: number;
  /** What the list prints: channel name, group name, or the other person. */
  title: string;
  /** 0764: the CALLER's own flags — Pulse's Favourites filter and Archived
   *  section. `archived` is personal; `is_archived` is a channel closed for all. */
  favorite: boolean;
  archived: boolean;
  /** 0764: the newest top-level message the caller may read, for the row's
   *  preview. `last_body` is null when it was deleted or file-only. */
  last_body: string | null;
  last_author_id: string | null;
  last_author_name: string | null;
  last_deleted: boolean;
  last_has_file: boolean;
}

/** A channel the caller may see in the browser, joined or not. */
export interface ChannelListing {
  id: string;
  name: string;
  topic: string | null;
  visibility: Visibility;
  department_name: string | null;
  is_archived: boolean;
  is_member: boolean;
}

export interface CommMember {
  user_id: string;
  role: MemberRole;
  joined_at: string;
  removed_at: string | null;
  /** Through `creator_names()`, never an embed — `profiles_read_own` (0001). */
  full_name: string | null;
  /** 0759: may be offered for @mention here (active login, not deactivated).
   *  Undefined before 0759 is applied — treated as yes, as before. */
  mentionable?: boolean;
}

export interface ConversationDetail {
  id: string;
  kind: ConversationKind;
  name: string | null;
  topic: string | null;
  visibility: Visibility;
  department_id: string | null;
  department_name: string | null;
  is_archived: boolean;
  created_at: string;
  /** 0751. NULL on a group, and on a channel nobody described. */
  description: string | null;
  /** 0751. NULL when not archived, and for one archived before 0751. */
  archived_at: string | null;
  title: string;
  members: CommMember[];
  /** The caller's own row; null when reading a public channel unjoined. */
  me: {
    role: MemberRole;
    muted: boolean;
    last_read_at: string | null;
    active: boolean;
    /** 0751: the caller's own pin and notification level. */
    pinned_at: string | null;
    notify_level: "all" | "mentions" | "none";
  } | null;
  /** Server-resolved: may rename, archive, add and remove (comm_can_manage). */
  can_manage: boolean;
}

export interface CommAttachment {
  id: string;
  file_name: string;
  /** Key within the PRIVATE comm-files bucket. Never a URL. */
  storage_path: string;
  mime_type: string;
  size_bytes: number;
}

export interface CommReaction {
  emoji: string;
  count: number;
  mine: boolean;
  /** Who reacted, oldest first (0760) — ids; names come from the member list. */
  users: string[];
}

export interface CommMessage {
  id: string;
  conversation_id: string;
  author_id: string | null;
  author_name: string | null;
  kind: "message" | "system";
  body: string | null;
  parent_id: string | null;
  reply_count: number;
  last_reply_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  pinned: boolean;
  saved: boolean;
  attachments: CommAttachment[];
  reactions: CommReaction[];
}

export interface MessagePage {
  /** Oldest first — a conversation is read downwards. */
  messages: CommMessage[];
  /** Pass back as `before` to load the page above; null at the start. */
  next_cursor: string | null;
}

export interface DirectoryPerson {
  id: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  department: string | null;
}

export interface MessageHit {
  message: CommMessage;
  conversation_title: string;
  /** 0762: what kind of conversation the hit is in (the result's context line). */
  conversation_kind?: ConversationKind;
}

/** What `sendMessage` answers. `created: false` = a retry of a send that already landed. */
export type SendResult =
  | { ok: true; id: string; created_at: string; created: boolean }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
//
// ## caps-input: exempt -- a chat message is prose, not a stored value
//
// AGENTS.md makes CAPITALS the default and withdrew the `<Textarea>`
// exemption, so this is said rather than assumed. It is the same carve-out
// lib/orders/community/types.ts already records for the order channel: a
// message is read by a person and matched by nothing — no picker resolves it,
// no duplicate check compares it, no import writes it.
//
// FLAGGED, NOT DECIDED (open question in the phase-1 plan): capitals is the
// client's standing rule and this is a new surface. If they want it, the change
// is a transform on `body` here AND dropping `uppercase={false}` on the
// composer — both halves, or typed text and loaded text disagree.

const uuid = z.string().uuid();

export const attachmentInput = z.object({
  storage_path: z.string().min(1).max(200),
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.string().min(1).max(120),
  size_bytes: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
});
export type AttachmentInput = z.infer<typeof attachmentInput>;

export const sendMessageInput = z.object({
  conversation_id: uuid,
  /** Minted ONCE per typed message by the browser; a retry resends it. */
  client_id: uuid,
  body: z.string().max(MESSAGE_MAX).nullable().default(null),
  parent_id: uuid.nullable().default(null),
  attachments: z.array(attachmentInput).max(ATTACHMENTS_PER_MESSAGE).default([]),
});
export type SendMessageInput = z.input<typeof sendMessageInput>;

export const editMessageInput = z.object({
  message_id: uuid,
  body: z.string().max(MESSAGE_MAX),
});

export const createGroupInput = z.object({
  name: z.string().trim().max(80).nullable().default(null),
  member_ids: z.array(uuid).min(1).max(99),
});
export type CreateGroupInput = z.input<typeof createGroupInput>;

export const updateConversationInput = z.object({
  conversation_id: uuid,
  name: z.string().trim().max(80).nullable().default(null),
  topic: z.string().trim().max(250).nullable().default(null),
  archived: z.boolean().nullable().default(null),
});
export type UpdateConversationInput = z.input<typeof updateConversationInput>;

export const memberIdsInput = z.object({
  conversation_id: uuid,
  user_ids: z.array(uuid).min(1).max(500),
});

export const memberRoleInput = z.object({
  conversation_id: uuid,
  user_id: uuid,
  role: z.enum(MEMBER_ROLES),
});

/**
 * Set a reaction on or off (0760). ADDING must be an emoji from the catalog
 * (`isAllowedEmoji`, = comm_allowed_emoji); REMOVING accepts any stored value,
 * so a reaction saved before the catalog existed can still be taken back.
 */
export const setReactionInput = z
  .object({
    message_id: uuid,
    emoji: z.string().min(1).max(32).regex(/^\S+$/u),
    on: z.boolean(),
  })
  .refine((v) => !v.on || isAllowedEmoji(v.emoji), { message: "That reaction cannot be used." });

/** Mirrors the reaction CHECK: 1–32 characters, no whitespace. */
export const reactionInput = z.object({
  message_id: uuid,
  emoji: z.string().min(1).max(32).regex(/^\S+$/u),
});

// ---------------------------------------------------------------------------
// Mentions: `<@profile-uuid>` in the body
// ---------------------------------------------------------------------------
//
// The id, not the name, is stored, so a renamed colleague's old mentions still
// resolve. The SERVER decides who was really mentioned (comm_parse_mentions:
// active members only) — this parser is for RENDERING, never for notifying.

const MENTION_RE =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;

export function mentionToken(profileId: string): string {
  return `<@${profileId}>`;
}

/** Distinct ids named by `<@uuid>` tokens, in order of first appearance. */
export function mentionIds(body: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (body ?? "").matchAll(MENTION_RE)) {
    const id = m[1].toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ERP record links: `<rec:kind:uuid>` in the body (phase 6)
// ---------------------------------------------------------------------------
//
// A LINK IS A POINTER, NEVER A GRANT (spec §8). The body stores only the kind
// and the id — no number, no vendor, no amount — so nothing about the record
// is copied into a chat that people outside its module can read. Every viewer's
// chip is resolved on the server AS THAT VIEWER (lib/comms/records.ts: the
// module's view permission, then the row through RLS); someone who may not see
// the record sees "not available to you" and no link. Opening it lands on the
// record's own screen, which checks access again.

export const RECORD_KINDS = {
  purchase_order: { label: "Purchase order", short: "PO", module: "materials_purchase", path: "/purchase/orders/" },
  purchase_indent: { label: "Purchase indent", short: "Indent", module: "materials_purchase", path: "/purchase/indents/" },
  sales_order: { label: "Order (RE)", short: "RE", module: "orders", path: "/orders/" },
} as const;
export type RecordKind = keyof typeof RECORD_KINDS;
export const RECORD_KIND_KEYS = Object.keys(RECORD_KINDS) as RecordKind[];

export function isRecordKind(k: unknown): k is RecordKind {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(RECORD_KINDS, k);
}

export function recordToken(kind: RecordKind, id: string): string {
  return `<rec:${kind}:${id}>`;
}

/** "purchase_order:<uuid>" — the key a preview is cached and returned under. */
export function recordKey(kind: RecordKind, id: string): string {
  return `${kind}:${id.toLowerCase()}`;
}

export function recordHref(kind: RecordKind, id: string): string {
  return `${RECORD_KINDS[kind].path}${id}`;
}

/** What a viewer allowed to see the record is shown. Deliberately NO amounts. */
export interface RecordPreview {
  kind: RecordKind;
  id: string;
  /** The document's own number — PO code, indent code, RE number. */
  number: string;
  /** Vendor / department / buyer. */
  party: string | null;
  status: string | null;
  /** The document's own date (order, required or ship date), ISO date. */
  date: string | null;
  href: string;
}

export const recordRefInput = z.object({ kind: z.enum(RECORD_KIND_KEYS as [RecordKind, ...RecordKind[]]), id: uuid });
export type RecordRef = z.infer<typeof recordRefInput>;

const KIND_ALT = RECORD_KIND_KEYS.join("|");
const UUID_SRC = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** One pass over a body: a mention OR a record token, in order. */
const TOKEN_RE = new RegExp(`<@(${UUID_SRC})>|<rec:(${KIND_ALT}):(${UUID_SRC})>`, "g");

/** Distinct record refs a body links, in order of first appearance. */
export function recordRefs(body: string | null | undefined): RecordRef[] {
  const out: RecordRef[] = [];
  const seen = new Set<string>();
  for (const m of (body ?? "").matchAll(TOKEN_RE)) {
    if (!m[2]) continue;
    const ref = { kind: m[2] as RecordKind, id: m[3].toLowerCase() };
    const k = recordKey(ref.kind, ref.id);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(ref);
    }
  }
  return out;
}

/**
 * Plain text split into text and LINK pieces. Only http(s) URLs become links —
 * never `javascript:`, `data:` or a bare `www.` — and trailing punctuation that
 * ends a sentence ("see https://x.com/a.") stays outside the link. The result
 * is rendered as React text and an <a href> whose scheme was checked here, so
 * nothing a colleague types can become markup or script on someone's screen.
 */
export type LinkPiece = { text: string } | { url: string };
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
export function linkPieces(text: string): LinkPiece[] {
  const out: LinkPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    let url = m[0];
    // Peel sentence punctuation, and a ")" the URL did not open.
    while (/[.,;:!?)\]]$/.test(url)) {
      if (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
      url = url.slice(0, -1);
    }
    let safe: URL | null = null;
    try {
      safe = new URL(url);
    } catch {
      safe = null;
    }
    if (!safe || (safe.protocol !== "http:" && safe.protocol !== "https:")) continue;
    if (i > at) out.push({ text: text.slice(at, i) });
    out.push({ url });
    at = i + url.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/**
 * A message as plain text for the clipboard: mentions as @Name (the name the
 * reader sees, never the uuid token), record links as their token-free label.
 */
export function plainText(
  body: string | null | undefined,
  names: Map<string, string | null>,
  recordLabel: (kind: RecordKind) => string = (k) => k.replace(/_/g, " "),
): string {
  return bodyPieces(body)
    .map((p) => ("text" in p ? p.text : "mention" in p ? `@${names.get(p.mention) ?? "someone"}` : `[${recordLabel(p.record.kind)}]`))
    .join("");
}

/** A body split into text, mention and record pieces, for a renderer to map over. */
export type BodyPiece = { text: string } | { mention: string } | { record: RecordRef };
export function bodyPieces(body: string | null | undefined): BodyPiece[] {
  const src = body ?? "";
  const out: BodyPiece[] = [];
  let at = 0;
  for (const m of src.matchAll(TOKEN_RE)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: src.slice(at, i) });
    if (m[1]) out.push({ mention: m[1].toLowerCase() });
    else out.push({ record: { kind: m[2] as RecordKind, id: m[3].toLowerCase() } });
    at = i + m[0].length;
  }
  if (at < src.length) out.push({ text: src.slice(at) });
  return out;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * The storage key for a new upload. THE FIRST FOLDER IS THE CONVERSATION — the
 * bucket's insert policy reads it to decide whether the uploader is a member,
 * and the send RPC refuses a key outside it. The file name is NOT in the key
 * (it is stored on the row): a name can hold characters a key cannot, and a key
 * that leaks a document's title into a URL is a key that says too much.
 */
export function attachmentPath(conversationId: string, fileName: string, id: string): string {
  const dot = fileName.lastIndexOf(".");
  const raw = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  const ext = /^[a-z0-9]{1,8}$/.test(raw) ? raw : "bin";
  return `${conversationId}/${id}.${ext}`;
}

/** The sentence to show for a file that cannot be sent, or null when it can. */
export function attachmentProblem(file: { name: string; type: string; size: number }): string | null {
  if (!(ALLOWED_MIME as readonly string[]).includes((file.type || "").toLowerCase())) {
    return `${file.name}: that file type cannot be shared here.`;
  }
  if (file.size < 1) return `${file.name} is empty.`;
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name} is over 20 MB.`;
  return null;
}

// ---------------------------------------------------------------------------
// History cursor: (created_at, id) of the oldest message on the page
// ---------------------------------------------------------------------------

export function encodeCursor(createdAt: string, id: string): string {
  return `${createdAt}|${id}`;
}

const TS_RE = /^\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}(:?\d{2})?)?$/;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Null for anything that is not exactly what encodeCursor wrote — a cursor is
 *  interpolated into a PostgREST filter, so it is validated, never trusted. */
export function decodeCursor(cursor: string | null | undefined): { created_at: string; id: string } | null {
  if (!cursor) return null;
  const bar = cursor.lastIndexOf("|");
  if (bar < 0) return null;
  const created_at = cursor.slice(0, bar);
  const id = cursor.slice(bar + 1);
  return TS_RE.test(created_at) && ID_RE.test(id) ? { created_at, id } : null;
}

// ---------------------------------------------------------------------------
// Titles and errors
// ---------------------------------------------------------------------------

export function conversationTitle(
  c: { kind: ConversationKind; name: string | null },
  names: (string | null | undefined)[],
): string {
  if (c.kind === "channel") return `#${c.name ?? "channel"}`;
  if (c.name && c.name.trim()) return c.name.trim();
  const known = names.filter((n): n is string => !!n && !!n.trim());
  if (c.kind === "direct") return known[0] ?? "Direct message";
  if (known.length === 0) return "Group";
  return known.length <= 3 ? known.join(", ") : `${known.slice(0, 3).join(", ")} +${known.length - 3}`;
}

/**
 * The sentence to show for a failed RPC. 0737 raises its refusals as readable
 * sentences under four codes, so those pass through; anything else (a network
 * fault, an unexpected constraint) gets the caller's fallback, never a driver
 * message with a table name in it.
 */
const SPOKEN_CODES = new Set(["42501", "22023", "55000", "23505"]);
export function commErrorText(
  error: { code?: string | null; message?: string | null } | null | undefined,
  fallback: string,
): string {
  if (error?.code && SPOKEN_CODES.has(error.code) && error.message?.trim()) {
    return error.message.trim();
  }
  return fallback;
}
