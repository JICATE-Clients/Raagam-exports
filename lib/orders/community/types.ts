import { z } from "zod";

// ============================================================================
// RE-Community — the order-centric collaboration channel (0458, doc/file.md §4).
//
// One channel per sales order, bound by `sales_order_id`. `re_number` is a
// DISPLAY copy of `sales_orders.order_number` — read it, print it, and NEVER
// parse, reformat or match on it.
//
// That is not fastidiousness: the column carries TWO live shapes, counted in
// this database on 2026-08-23 — `U2/RE//2526/2047` (legacy, double slash after
// RE, no dash: 86 rows) and `HO/RE/26-27/0001` (current, dashed fiscal year per
// 0431: 5 rows). Any code that splits, pads, or compares that string is written
// against one of them and silently matches nothing in the other, which is 95% of
// the orders. No format appears anywhere in `lib/orders/community/**`.
// ============================================================================

/** What a member IS in the channel. Matches 0458's `channel_role` CHECK. */
export const CHANNEL_ROLES = [
  "merchandiser",
  "cad",
  "cutting_room",
  "quality",
  "planner",
] as const;
export type ChannelRole = (typeof CHANNEL_ROLES)[number];

export const CHANNEL_ROLE_LABELS: Record<ChannelRole, string> = {
  merchandiser: "Merchandiser",
  cad: "CAD Technician",
  cutting_room: "Cutting Room",
  quality: "Quality",
  planner: "Planner",
};

/**
 * Human vs bot is a COLUMN, not a prefix on the body (0458). A prefix is
 * something a person can type, so a stream production reads as automatic could
 * be forged; the insert policy refuses any kind but `message` from a session.
 */
export type MessageKind = "message" | "bot" | "system";

export interface OrderChannel {
  id: string;
  sales_order_id: string;
  /** Display only. The join key is `sales_order_id`. */
  re_number: string | null;
  topic: string | null;
  is_archived: boolean;
  created_at: string;
}

export interface ChannelMember {
  id: string;
  channel_id: string;
  user_id: string;
  channel_role: ChannelRole | null;
  join_reason: "rule" | "manual" | "order_owner";
  last_read_at: string | null;
  removed_at: string | null;
  added_at: string;
  /**
   * Resolved through `creator_names()`, NOT a PostgREST embed on `profiles`:
   * `profiles_read_own` (0001) hides other users' rows from a non-admin, so an
   * embed resolves to null for everybody but yourself. That is the failure
   * `lib/created-by.ts` was written to stop, and a member list is the screen
   * where it would be most visible — every name but your own reading "—".
   */
  full_name: string | null;
}

export interface ChannelFile {
  id: string;
  message_id: string;
  file_name: string;
  /** Key within the PRIVATE `order-community-files` bucket. Never a URL. */
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  author_id: string | null;
  kind: MessageKind;
  body: string | null;
  /** Stable machine key for a bot alert, e.g. `cad_weights_submitted`. */
  event_key: string | null;
  href: string | null;
  parent_id: string | null;
  edited_at: string | null;
  created_at: string;
  files: ChannelFile[];
  /** See `ChannelMember.full_name`. NULL on a bot message is correct: nobody wrote it. */
  author_name: string | null;
}

/** One attachment as the composer holds it — the upload has already happened. */
export const messageFileInput = z.object({
  file_name: z.string().min(1),
  storage_path: z.string().min(1),
  mime_type: z.string().nullable().default(null),
  size_bytes: z.number().int().nonnegative().nullable().default(null),
});

/**
 * ## caps-input: exempt -- a chat message is prose, not a stored value
 *
 * AGENTS.md makes CAPITALS the default and withdrew the `<Textarea>` exemption,
 * so this needs saying rather than assuming. The carve-out the client granted
 * for LC / PO terms is the same shape as this one, in their own words: those
 * clauses are read as language, "where capitals change how the text reads rather
 * than how a value is stored". A message in this stream is read by a person and
 * matched by nothing — no picker resolves it, no duplicate check compares it, no
 * import writes it. Block capitals here is shouting at the cutting room.
 *
 * FLAGGED, not decided: capitals is the client's standing rule and this is a new
 * surface they have not seen. If they want it capitalised the change is
 * `capsTextNullable()` here and dropping `uppercase={false}` on the composer —
 * both halves, or the rule holds for typed text and not for loaded text.
 */
export const postMessageInput = z.object({
  sales_order_id: z.string().uuid(),
  body: z.string().max(4000).nullable().default(null),
  parent_id: z.string().uuid().nullable().default(null),
  files: z.array(messageFileInput).default([]),
});
export type PostMessageInput = z.infer<typeof postMessageInput>;

export const editMessageInput = z.object({
  message_id: z.string().uuid(),
  body: z.string().max(4000),
});

/** A bot alert. `body` is the sentence the stream prints. */
export const botAlertInput = z.object({
  sales_order_id: z.string().uuid(),
  event_key: z.string().min(1).max(64),
  body: z.string().min(1).max(1000),
  href: z.string().max(512).nullable().default(null),
  /** Title on the `notifications` row. Falls back to the channel's RE Number. */
  title: z.string().max(200).nullable().default(null),
});
export type BotAlertInput = z.infer<typeof botAlertInput>;

/** The private bucket 0458 creates. NOT `garment-order-docs`, which any
 *  orders:view holder can read — see 0458 §9. */
export const COMMUNITY_BUCKET = "order-community-files";

/**
 * A message carries text, or files, or both — never neither.
 *
 * Kept out of the server action (which is `"use server"`, so nothing in it can
 * be imported by a vector) for the reason `lib/orders/amendments/file-rows.ts`
 * records: the arithmetic can live anywhere, so it lives where it can be proved.
 * Returns the SENTENCE the screen prints, never `false` — house style, and the
 * caller has nothing to say on its own.
 */
export type Refusal = { refused: string };
export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && typeof (v as Refusal).refused === "string";
}

export function messageContent(
  input: Pick<PostMessageInput, "body" | "files">,
): { body: string | null; files: PostMessageInput["files"] } | Refusal {
  const body = input.body && input.body.trim() ? input.body.trim() : null;
  // `storage_path` IS the row's identity, exactly as 0416's file rows are:
  // the upload happens when the file is chosen, so a row with no path is a row
  // whose upload FAILED. Writing it puts an attachment in the stream that
  // resolves to nothing when the cutting room clicks it looking for a marker.
  const files = (input.files ?? []).filter((f) => !!f.storage_path?.trim());
  if (!body && files.length === 0) {
    return { refused: "Type a message or attach a file." };
  }
  return { body, files };
}
