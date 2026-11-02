"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { listMyConversations } from "./service";
import { commErrorText, communityInput, type CommunityInput } from "./types";

/**
 * Writes for Pulse Communities (0775). Same shape as actions.ts: Zod at the
 * door, a sentence instead of a driver message, an audit row — and the guard
 * is the SECURITY DEFINER RPC, which takes the actor from auth.uid() and
 * checks community / group roles itself.
 */

type Fail = { ok: false; error: string };
type Result = { ok: true; id?: string } | Fail;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: string): Fail {
  return { ok: false, error };
}
function uuids(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === "string" && UUID_RE.test(x)) ? (v as string[]) : null;
}
function revHub(): void {
  revalidatePath("/comms", "layout");
}

export async function createCommunity(input: CommunityInput & { group_ids: string[] }): Promise<Result> {
  const parsed = communityInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the community details.");
  const groups = uuids(input.group_ids ?? []);
  if (!groups) return fail("Pick groups from the list.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_create_community", {
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_group_ids: groups,
  });
  if (error || !data) return fail(commErrorText(error, "The community could not be created."));
  await writeAudit({
    action: "comm.community_created",
    entityType: "comm_community",
    entityId: data as string,
    metadata: { name: parsed.data.name, group_ids: groups },
  });
  revHub();
  return { ok: true, id: data as string };
}

export async function updateCommunity(id: string, input: CommunityInput): Promise<Result> {
  if (!UUID_RE.test(id)) return fail("Unknown community.");
  const parsed = communityInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the community details.");
  const s = await createClient();
  const { error } = await s.rpc("comm_community_update", {
    p_community: id,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
  });
  if (error) return fail(commErrorText(error, "The community could not be saved."));
  await writeAudit({ action: "comm.community_updated", entityType: "comm_community", entityId: id, metadata: parsed.data });
  revHub();
  return { ok: true };
}

export async function addCommunityGroups(id: string, groupIds: string[]): Promise<Result> {
  const groups = uuids(groupIds);
  if (!UUID_RE.test(id) || !groups || groups.length === 0) return fail("Pick at least one group to add.");
  const s = await createClient();
  const { error } = await s.rpc("comm_community_add_groups", { p_community: id, p_group_ids: groups });
  if (error) return fail(commErrorText(error, "Those groups could not be added."));
  await writeAudit({ action: "comm.community_groups_added", entityType: "comm_community", entityId: id, metadata: { group_ids: groups } });
  revHub();
  return { ok: true };
}

export async function removeCommunityGroup(id: string, conversationId: string): Promise<Result> {
  if (!UUID_RE.test(id) || !UUID_RE.test(conversationId)) return fail("Unknown group.");
  const s = await createClient();
  const { error } = await s.rpc("comm_community_remove_group", { p_community: id, p_conv: conversationId });
  if (error) return fail(commErrorText(error, "The group could not be removed."));
  await writeAudit({ action: "comm.community_group_removed", entityType: "comm_community", entityId: id, metadata: { conversation_id: conversationId } });
  revHub();
  return { ok: true };
}

export async function joinCommunityGroup(conversationId: string): Promise<{ ok: true; outcome: "joined" | "requested" } | Fail> {
  if (!UUID_RE.test(conversationId)) return fail("Unknown group.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_community_join", { p_conv: conversationId });
  if (error) return fail(commErrorText(error, "You could not join that group."));
  revHub();
  return { ok: true, outcome: data === "requested" ? "requested" : "joined" };
}

export async function decideCommunityRequest(requestId: string, approve: boolean): Promise<Result> {
  if (!UUID_RE.test(requestId)) return fail("Unknown request.");
  const s = await createClient();
  const { error } = await s.rpc("comm_community_decide", { p_request: requestId, p_approve: approve === true });
  if (error) return fail(commErrorText(error, "That request could not be answered."));
  await writeAudit({
    action: approve ? "comm.community_request_approved" : "comm.community_request_declined",
    entityType: "comm_community_request",
    entityId: requestId,
  });
  revHub();
  return { ok: true };
}

export async function addCommunityMembers(id: string, userIds: string[]): Promise<Result & { added?: number }> {
  const ids = uuids(userIds);
  if (!UUID_RE.test(id) || !ids || ids.length === 0) return fail("Pick at least one person to add.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_community_add_members", { p_community: id, p_user_ids: ids });
  if (error) return fail(commErrorText(error, "Those people could not be added."));
  await writeAudit({ action: "comm.community_members_added", entityType: "comm_community", entityId: id, metadata: { user_ids: ids, added: data } });
  revHub();
  return { ok: true, added: (data as number) ?? 0 };
}

export async function setCommunityRole(id: string, userId: string, role: "admin" | "member"): Promise<Result> {
  if (!UUID_RE.test(id) || !UUID_RE.test(userId) || (role !== "admin" && role !== "member")) return fail("Unknown member.");
  const s = await createClient();
  const { error } = await s.rpc("comm_community_set_role", { p_community: id, p_user: userId, p_role: role });
  if (error) return fail(commErrorText(error, "The role could not be changed."));
  await writeAudit({ action: "comm.community_role_set", entityType: "comm_community", entityId: id, metadata: { user_id: userId, role } });
  revHub();
  return { ok: true };
}

export async function setGroupJoinPolicy(conversationId: string, policy: "open" | "request"): Promise<Result> {
  if (!UUID_RE.test(conversationId) || (policy !== "open" && policy !== "request")) return fail("Unknown group.");
  const s = await createClient();
  const { error } = await s.rpc("comm_community_set_join_policy", { p_conv: conversationId, p_policy: policy });
  if (error) return fail(commErrorText(error, "That could not be changed."));
  revHub();
  return { ok: true };
}

export async function leaveCommunity(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return fail("Unknown community.");
  const s = await createClient();
  const { error } = await s.rpc("comm_community_leave", { p_community: id });
  if (error) return fail(commErrorText(error, "You could not leave the community."));
  await writeAudit({ action: "comm.community_left", entityType: "comm_community", entityId: id });
  revHub();
  return { ok: true };
}

/** The caller's own groups that can join a community: groups they own or
 *  admin, not already in one, not an Announcements chat. */
export async function myLinkableGroups(): Promise<{ ok: true; groups: { id: string; title: string; member_count: number }[] } | Fail> {
  try {
    const all = await listMyConversations("group");
    return {
      ok: true,
      groups: all
        .filter((c) => !c.community_id && !c.is_announcement && !c.is_archived && (c.my_role === "owner" || c.my_role === "admin"))
        .map((c) => ({ id: c.id, title: c.title, member_count: c.member_count })),
    };
  } catch {
    return fail("Your groups could not be read.");
  }
}
