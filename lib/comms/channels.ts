import { z } from "zod";
import { VISIBILITIES, type MemberRole, type Visibility } from "./types";

// ============================================================================
// Communication Hub — channel management (0751).
//
// A channel is a `comm_conversations` row of kind 'channel' (0737); this file
// is the TypeScript half of 0751's rules. Pure, so the screens, the server
// actions and scripts/check-comms-channels.mts read the same definitions.
//
// THE DATABASE IS THE GUARD. `comm_channel_can()` decides every action and
// `comm_channel_abilities()` hands the same answers to the screen as
// `ChannelAbilities` — nothing here decides a permission on its own.
// ============================================================================

/** comm_members.role on a channel. The stored 'admin' IS the moderator (0751 header). */
export const CHANNEL_ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Moderator",
  member: "Member",
};

export const NOTIFY_LEVELS = ["all", "mentions", "none"] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export const NOTIFY_LABEL: Record<NotifyLevel, string> = {
  all: "All messages",
  mentions: "Mentions only",
  none: "Nothing",
};

export const CHANNEL_SCOPES = ["active", "archived"] as const;
export type ChannelScope = (typeof CHANNEL_SCOPES)[number];

/** Mirrors 0751: name ≤ 80, topic ≤ 250, description ≤ 500. */
export const CHANNEL_NAME_MAX = 80;
export const CHANNEL_TOPIC_MAX = 250;
export const CHANNEL_DESC_MAX = 500;
export const DISCOVER_PAGE = 30;

/**
 * `comm_channel_slug()`: trimmed, lowercased, runs of whitespace → one '-'.
 * The screen shows this as "will be created as #…" while the operator types.
 */
export function normalizeChannelName(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

/** `comm_channel_name_problem()` — null when the (normalised) name is valid. */
export function channelNameProblem(slug: string): string | null {
  if (!slug) return "A channel needs a name.";
  if (slug.length > CHANNEL_NAME_MAX) return "Keep the channel name to 80 characters.";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    return "Use lowercase letters, numbers, - and _ in a channel name, starting with a letter or number.";
  }
  return null;
}

/** `comm_channel_abilities()` — what the caller may do on one channel. */
export interface ChannelAbilities {
  role: MemberRole | null;
  /** A workspace owner/admin or communication:edit holder on a PUBLIC channel. */
  governs: boolean;
  edit_info: boolean;
  rename: boolean;
  add_members: boolean;
  remove_members: boolean;
  remove_privileged: boolean;
  set_roles: boolean;
  transfer: boolean;
  archive: boolean;
  join: boolean;
  leave: boolean;
  preferences: boolean;
}

export const NO_ABILITIES: ChannelAbilities = {
  role: null,
  governs: false,
  edit_info: false,
  rename: false,
  add_members: false,
  remove_members: false,
  remove_privileged: false,
  set_roles: false,
  transfer: false,
  archive: false,
  join: false,
  leave: false,
  preferences: false,
};

/** One row of `comm_discover_channels()`. */
export interface DiscoveredChannel {
  id: string;
  name: string;
  description: string | null;
  topic: string | null;
  visibility: Visibility;
  department_name: string | null;
  is_archived: boolean;
  archived_at: string | null;
  member_count: number;
  is_member: boolean;
  my_role: MemberRole | null;
}

/** One row of `comm_sidebar_channels()` — pinned first, then by name. */
export interface SidebarChannel {
  id: string;
  name: string;
  visibility: Visibility;
  my_role: MemberRole;
  pinned_at: string | null;
  notify_level: NotifyLevel;
  unread_count: number;
  mention_count: number;
}

// ---------------------------------------------------------------------------
// Inputs (Zod at the door; every RPC re-checks)
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();
const optText = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${what} to ${max} characters.`)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

/** The name is normalised HERE too, so the error the operator reads is about
 *  the name the database will actually be asked to store. */
const channelName = z
  .string()
  .transform(normalizeChannelName)
  .superRefine((v, ctx) => {
    const problem = channelNameProblem(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const createChannelInput = z.object({
  name: channelName,
  visibility: z.enum(VISIBILITIES),
  description: optText(CHANNEL_DESC_MAX, "description"),
  topic: optText(CHANNEL_TOPIC_MAX, "topic"),
  department_id: uuid.nullable().default(null),
  member_ids: z.array(uuid).max(500).default([]),
  /** Minted once per open sheet; a retry with the same key returns the same channel. */
  create_key: uuid,
});
export type CreateChannelInput = z.input<typeof createChannelInput>;

export const updateChannelInput = z.object({
  conversation_id: uuid,
  name: channelName,
  description: optText(CHANNEL_DESC_MAX, "description"),
  topic: optText(CHANNEL_TOPIC_MAX, "topic"),
});
export type UpdateChannelInput = z.input<typeof updateChannelInput>;

export const transferInput = z.object({
  conversation_id: uuid,
  to_user_id: uuid,
  step_down_to: z.enum(["admin", "member"]).default("admin"),
});
export type TransferInput = z.input<typeof transferInput>;

export const prefsInput = z.object({
  conversation_id: uuid,
  pinned: z.boolean().nullable().default(null),
  notify_level: z.enum(NOTIFY_LEVELS).nullable().default(null),
});
export type PrefsInput = z.input<typeof prefsInput>;

export const discoverInput = z.object({
  q: z.string().trim().max(80).nullable().default(null),
  scope: z.enum(CHANNEL_SCOPES).default("active"),
  offset: z.number().int().min(0).max(100000).default(0),
});
export type DiscoverInput = z.input<typeof discoverInput>;

/** Sidebar order, for a list that was changed in the browser before the
 *  server re-reads it: pinned first in the order pinned, then by name. */
export function sortSidebar<T extends { name: string; pinned_at: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (!!a.pinned_at !== !!b.pinned_at) return a.pinned_at ? -1 : 1;
    if (a.pinned_at && b.pinned_at && a.pinned_at !== b.pinned_at) return a.pinned_at < b.pinned_at ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
