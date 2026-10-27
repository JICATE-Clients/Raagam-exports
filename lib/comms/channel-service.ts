import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  DISCOVER_PAGE,
  NO_ABILITIES,
  type ChannelAbilities,
  type ChannelScope,
  type DiscoveredChannel,
  type SidebarChannel,
} from "./channels";

/**
 * Channel reads (0751). Each is an RPC that decides from `auth.uid()` what the
 * caller may see: discovery never names a private channel the caller is not
 * in, the sidebar lists only the caller's own memberships, and abilities come
 * from the same `comm_channel_can()` every write enforces. No admin client.
 *
 * A failed read THROWS (lib/comms/service.ts: an empty list that is really an
 * error gets believed) — except abilities, where "not found" is an answer.
 */

class ChannelReadError extends Error {
  code: string | null;
  constructor(what: string, error: { message: string; code?: string | null }) {
    super(`Could not read ${what}: ${error.message}`);
    this.code = error.code ?? null;
  }
}

export async function discoverChannels(
  q: string | null,
  scope: ChannelScope,
  offset = 0,
): Promise<{ rows: DiscoveredChannel[]; total: number }> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_discover_channels", {
    p_q: q?.trim() || null,
    p_scope: scope,
    p_limit: DISCOVER_PAGE,
    p_offset: offset,
  });
  if (error) throw new ChannelReadError("channels", error);
  const rows = (data ?? []) as (DiscoveredChannel & { total_count: number })[];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export async function sidebarChannels(): Promise<SidebarChannel[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_sidebar_channels");
  if (error) throw new ChannelReadError("your channels", error);
  return (data ?? []) as SidebarChannel[];
}

/** What the caller may do on a channel; no abilities when it cannot see it. */
export async function channelAbilities(conversationId: string): Promise<ChannelAbilities> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_channel_abilities", { p_conv: conversationId });
  if (error) {
    if (error.code === "22023") return NO_ABILITIES;
    throw new ChannelReadError("the channel's permissions", error);
  }
  return data as ChannelAbilities;
}

/** Every channel the caller can see (public ones and their private ones), by
 *  name — the Search page's Channel filter. Up to 100; the same visibility as
 *  discovery, so a private channel they are not in is never offered. */
export async function channelOptions(): Promise<{ id: string; name: string; visibility: string }[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_discover_channels", { p_q: null, p_scope: "active", p_limit: 100, p_offset: 0 });
  if (error) throw new ChannelReadError("channels", error);
  return ((data ?? []) as { id: string; name: string; visibility: string }[]).map(({ id, name, visibility }) => ({ id, name, visibility }));
}
