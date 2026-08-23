import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  ChannelMember,
  ChannelMessage,
  OrderChannel,
  ChannelRole,
} from "./types";

/**
 * Reads for the RE-Community channel (0458, doc/file.md §4).
 *
 * Every read here is gated by RLS on MEMBERSHIP, not on `orders:view` — so a
 * non-member calling any of these gets an empty result rather than a stream.
 * That is deliberate and it means an empty channel and a forbidden channel look
 * identical from here; `getOrderChannel` distinguishes them by returning null
 * only when the channel genuinely could not be resolved.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * uuid → display name for message authors and members.
 *
 * ## Why this is not `withCreators()` from lib/created-by.ts
 *
 * That helper reads one hardcoded column, `created_by`, because every listing it
 * serves has one. A message's author column is `author_id` and a member's is
 * `user_id`, so it has nothing to resolve here — it would return the rows
 * untouched and every name would print "—", which is exactly the silent failure
 * AGENTS.md warns about under "Created Date / Created User": the column half
 * passing says nothing about whether the value arrived.
 *
 * What it DOES share is the part that matters: `creator_names()` rather than a
 * PostgREST embed on `profiles`. `profiles_read_own` (0001) lets a user select
 * only their OWN profile row, so `author:profiles!author_id(full_name)` resolves
 * to null for every message anybody else wrote — on a chat stream, that is every
 * message but yours.
 */
async function resolveNames(
  s: Awaited<ReturnType<typeof createClient>>,
  ids: (string | null | undefined)[],
): Promise<Map<string, string | null>> {
  const unique = Array.from(
    new Set(ids.filter((v): v is string => typeof v === "string" && UUID_RE.test(v))),
  );
  if (unique.length === 0) return new Map();
  const { data } = await s.rpc("creator_names", { ids: unique });
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name,
    ]),
  );
}

/**
 * The channel for an order, creating it if it does not exist yet.
 *
 * GET-OR-CREATE, and that is not belt-and-braces. `trg_so_spawn_channel`
 * swallows its own failure so that an order can never fail to save because its
 * chat room could not be made (0458 §6) — this call is what heals the gap, and
 * it is also what backfills a channel for any order created before 0458 applied.
 * It re-runs the auto-join rule at the same time, which is how a CAD technician
 * hired this month reaches a channel spawned last month.
 */
export async function getOrderChannel(salesOrderId: string): Promise<OrderChannel | null> {
  const s = await createClient();
  const { data: channelId } = await s.rpc("ensure_order_channel", {
    p_sales_order_id: salesOrderId,
  });
  if (!channelId) return null;

  const { data } = await s
    .from("order_channels")
    .select("id, sales_order_id, re_number, topic, is_archived, created_at")
    .eq("id", channelId as string)
    .maybeSingle();
  return (data as OrderChannel | null) ?? null;
}

export async function getChannelMembers(channelId: string): Promise<ChannelMember[]> {
  const s = await createClient();
  const { data } = await s
    .from("order_channel_members")
    .select(
      "id, channel_id, user_id, channel_role, join_reason, last_read_at, removed_at, added_at",
    )
    .eq("channel_id", channelId)
    .is("removed_at", null)
    .order("added_at");

  const rows = (data ?? []) as Omit<ChannelMember, "full_name">[];
  const names = await resolveNames(s, rows.map((r) => r.user_id));
  return rows.map((r) => ({
    ...r,
    channel_role: (r.channel_role as ChannelRole | null) ?? null,
    full_name: names.get(r.user_id) ?? null,
  }));
}

/**
 * The stream, oldest first — a conversation is read downwards.
 *
 * `limit` is applied to the NEWEST rows and the page is then reversed, so a long
 * channel shows its recent end rather than its opening day.
 */
export async function getChannelMessages(
  channelId: string,
  limit = 200,
): Promise<ChannelMessage[]> {
  const s = await createClient();
  const { data } = await s
    .from("order_channel_messages")
    .select(
      "id, channel_id, author_id, kind, body, event_key, href, parent_id, edited_at, created_at, order_channel_files(id, message_id, file_name, storage_path, mime_type, size_bytes)",
    )
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = ((data ?? []) as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      ...(row as unknown as Omit<ChannelMessage, "files" | "author_name">),
      files: (row.order_channel_files ?? []) as ChannelMessage["files"],
    };
  });

  const names = await resolveNames(s, rows.map((r) => r.author_id));
  return rows
    .map((r) => ({
      ...r,
      // NULL here is a REAL value on a bot row and not a lookup miss: nobody
      // wrote it. The screen prints the bot's own label, never a dash.
      author_name: r.author_id ? (names.get(r.author_id) ?? null) : null,
    }))
    .reverse();
}

/**
 * Messages in this channel newer than the caller's own `last_read_at`.
 *
 * Counted with `head: true` so nothing is transferred — a channel badge must not
 * cost the same as opening the channel.
 */
export async function getUnreadCount(
  channelId: string,
  userId: string,
): Promise<number> {
  const s = await createClient();
  const { data: me } = await s
    .from("order_channel_members")
    .select("last_read_at")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();

  let q = s
    .from("order_channel_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId);

  const since = (me as { last_read_at: string | null } | null)?.last_read_at;
  // No marker at all means the member has never opened the channel, so every
  // message is unread. Defaulting to "none unread" would hide the very first
  // bot alert an auto-joined stakeholder ever receives.
  if (since) q = q.gt("created_at", since);

  const { count } = await q;
  return count ?? 0;
}

/**
 * Every channel the caller is a member of that has something they have not read.
 * RLS does the scoping — no `.eq("user_id", ...)` is needed for correctness, and
 * one is added anyway so the query is right even if a policy is later widened.
 *
 * created-by: exempt -- this is the caller's own unread feed, not a listing of
 * records anybody made: it has no Created User column to fill and no
 * `withCreatedColumns` around it. `order_channels.created_by` is NULL on every
 * row in the table by design — a channel is SPAWNED by `trg_so_spawn_channel`
 * (0458), so resolving it would print a dash beside every row and claim the
 * question had been asked and answered. The `created_at` in the select is the
 * channel's own age, read by the sort, not a Created Date cell.
 */
export async function listMyChannels(userId: string): Promise<
  { channel: OrderChannel; unread: number }[]
> {
  const s = await createClient();
  const { data } = await s
    .from("order_channel_members")
    .select(
      "last_read_at, order_channels!inner(id, sales_order_id, re_number, topic, is_archived, created_at)",
    )
    .eq("user_id", userId)
    .is("removed_at", null);

  const rows = (data ?? []) as unknown as {
    last_read_at: string | null;
    order_channels: OrderChannel;
  }[];

  return Promise.all(
    rows
      .filter((r) => !r.order_channels.is_archived)
      .map(async (r) => ({
        channel: r.order_channels,
        unread: await getUnreadCount(r.order_channels.id, userId),
      })),
  );
}
