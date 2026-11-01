import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  CommunityDetail,
  CommunityGroup,
  CommunityMember,
  CommunityRequest,
  CommunityRole,
  CommunitySummary,
} from "./types";

/**
 * Reads for Pulse Communities (0775). Every read runs as the caller through
 * RLS or a SECURITY DEFINER reader that checks community membership itself, so
 * a guessed community id comes back as nothing.
 *
 * NOT INSTALLED IS NOT AN ERROR. The screen ships with a pull and the tables
 * with the migration; until 0775 is applied `listMyCommunities()` answers null
 * and the Communities filter says the migration is missing, instead of the hub
 * throwing. Any other failure throws (a failed read is not an empty list).
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not read ${what}: ${error.message}`);
}

async function names(s: Sb, ids: string[]): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids.filter((v) => UUID_RE.test(v))));
  if (unique.length === 0) return new Map();
  const { data, error } = await s.rpc("creator_names", { ids: unique });
  if (error) fail("people's names", error);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map((r) => [r.id, r.full_name]));
}

/** The caller's communities, by name. Null when 0775 is not applied yet. */
export const listMyCommunities = cache(async function listMyCommunities(): Promise<CommunitySummary[] | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_my_communities");
  if (error) {
    if (error.code && MISSING.has(error.code)) return null;
    fail("communities", error);
  }
  return ((data ?? []) as (CommunitySummary & { created_at: string })[]).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    announcement_id: r.announcement_id,
    my_role: r.my_role,
    member_count: r.member_count,
    group_count: r.group_count,
  }));
});

/** Every group of each of the caller's communities, keyed by community. */
export async function listCommunityGroups(ids: string[]): Promise<Map<string, CommunityGroup[]>> {
  const out = new Map<string, CommunityGroup[]>();
  if (ids.length === 0) return out;
  const s = await createClient();
  const results = await Promise.all(ids.map((id) => s.rpc("comm_community_groups", { p_community: id })));
  results.forEach((r, i) => {
    if (r.error) fail("a community's groups", r.error);
    out.set(ids[i], (r.data ?? []) as CommunityGroup[]);
  });
  return out;
}

/** One community the caller is in, with its groups, members and the requests
 *  the caller may answer. Null for an id the caller is not in. */
export async function getCommunity(id: string): Promise<CommunityDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const mine = await listMyCommunities();
  const summary = mine?.find((c) => c.id === id);
  if (!summary) return null;
  const s = await createClient();
  const [groupsR, pendingR, membersR] = await Promise.all([
    s.rpc("comm_community_groups", { p_community: id }),
    s.rpc("comm_community_pending", { p_community: id }),
    s.from("comm_community_members").select("user_id, role").eq("community_id", id).is("removed_at", null).order("joined_at"),
  ]);
  if (groupsR.error) fail("the community's groups", groupsR.error);
  if (pendingR.error) fail("join requests", pendingR.error);
  if (membersR.error) fail("the community's members", membersR.error);
  const pending = (pendingR.data ?? []) as Omit<CommunityRequest, "full_name">[];
  const memberRows = (membersR.data ?? []) as { user_id: string; role: CommunityRole }[];
  const who = await names(s, [...pending.map((p) => p.user_id), ...memberRows.map((m) => m.user_id)]);
  const rank: Record<CommunityRole, number> = { owner: 0, admin: 1, member: 2 };
  const members: CommunityMember[] = memberRows
    .map((m) => ({ user_id: m.user_id, role: m.role, full_name: who.get(m.user_id) ?? null }))
    .sort((a, b) => rank[a.role] - rank[b.role] || (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  return {
    ...summary,
    groups: (groupsR.data ?? []) as CommunityGroup[],
    requests: pending.map((p) => ({ ...p, full_name: who.get(p.user_id) ?? null })),
    members,
  };
}
