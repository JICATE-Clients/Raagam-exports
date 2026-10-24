"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { allow } from "@/lib/rate-limit";
import {
  getMessages,
  getPinned,
  getThread,
  searchDirectory,
  searchMessages,
} from "./service";
import {
  COMM_BUCKET,
  commErrorText,
  createChannelInput,
  createGroupInput,
  editMessageInput,
  memberIdsInput,
  memberRoleInput,
  reactionInput,
  sendMessageInput,
  updateConversationInput,
  type CommMessage,
  type CreateChannelInput,
  type CreateGroupInput,
  type DirectoryPerson,
  type MessageHit,
  type MessagePage,
  type SendMessageInput,
  type SendResult,
  type UpdateConversationInput,
} from "./types";

/**
 * Writes for the Communication Hub (0737).
 *
 * ## THE GUARD IS THE RPC, NOT THIS FILE
 *
 * Every write calls a SECURITY DEFINER function that takes the actor from
 * `auth.uid()` and checks membership / ownership / `communication:*` itself,
 * so a request crafted around this file is refused by Postgres the same way.
 * What this file adds: Zod at the door, a sentence instead of a driver message,
 * a `can()` pre-check where it saves a round trip, the audit row, and the
 * storage clean-up the database cannot do.
 *
 * Nothing here accepts a sender, author or member id for the CALLER — there is
 * no parameter to forge (spec §10).
 *
 * ## NO REVALIDATION ON A SEND
 *
 * A message is appended by the screen (optimistic, then reconciled with the
 * returned row) and fanned out by Realtime. Re-rendering the route on every
 * keystroke-and-Enter would flicker the whole hub under the operator — the
 * reason lib/orders/community/actions.ts gives for `markChannelRead`.
 * Structural changes (a new conversation, a join, a rename) DO revalidate.
 *
 * ## NOTIFICATIONS ARE PHASE 4
 *
 * `sendMessage` returns `mentioned` and `created` from the RPC. Phase 4 hands
 * them to `notify()` — and only when `created` is true, so a retried send can
 * never notify twice.
 */

type Fail = { ok: false; error: string };
type Result = { ok: true; id?: string } | Fail;

function fail(error: string): Fail {
  return { ok: false, error };
}

function revHub(): void {
  revalidatePath("/comms", "layout");
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** Open (or find) the one direct conversation with `otherUserId`. */
export async function openDirect(otherUserId: string): Promise<Result> {
  if (typeof otherUserId !== "string" || !otherUserId) return fail("Pick someone to message.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_open_direct", { p_other: otherUserId });
  if (error || !data) return fail(commErrorText(error, "That conversation could not be opened."));
  revHub();
  return { ok: true, id: data as string };
}

export async function createGroup(input: CreateGroupInput): Promise<Result> {
  const parsed = createGroupInput.safeParse(input);
  if (!parsed.success) return fail("Add at least one person to the group.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_create_group", {
    p_name: parsed.data.name,
    p_member_ids: parsed.data.member_ids,
  });
  if (error || !data) return fail(commErrorText(error, "The group could not be created."));
  revHub();
  return { ok: true, id: data as string };
}

export async function createChannel(input: CreateChannelInput): Promise<Result> {
  if (!(await can("communication", "create"))) return fail("You do not have permission to create channels.");
  const parsed = createChannelInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the channel details.");
  const d = parsed.data;
  const s = await createClient();
  const { data, error } = await s.rpc("comm_create_channel", {
    p_name: d.name,
    p_visibility: d.visibility,
    p_topic: d.topic,
    p_department_id: d.department_id,
    p_member_ids: d.member_ids,
  });
  if (error || !data) return fail(commErrorText(error, "The channel could not be created."));
  await writeAudit({
    action: "comm.channel_created",
    entityType: "comm_conversation",
    entityId: data as string,
    metadata: { name: d.name, visibility: d.visibility, department_id: d.department_id },
  });
  revHub();
  return { ok: true, id: data as string };
}

/** Rename, re-topic, or (un)archive a group or channel. */
export async function updateConversation(input: UpdateConversationInput): Promise<Result> {
  const parsed = updateConversationInput.safeParse(input);
  if (!parsed.success) return fail("Check the name and topic.");
  const d = parsed.data;
  const s = await createClient();
  const { error } = await s.rpc("comm_update_conversation", {
    p_conv: d.conversation_id,
    p_name: d.name,
    p_topic: d.topic,
    p_archived: d.archived,
  });
  if (error) return fail(commErrorText(error, "The conversation could not be updated."));
  await writeAudit({
    action: d.archived === true ? "comm.archived" : d.archived === false ? "comm.unarchived" : "comm.renamed",
    entityType: "comm_conversation",
    entityId: d.conversation_id,
    metadata: { name: d.name, topic: d.topic },
  });
  revHub();
  return { ok: true };
}

export async function joinChannel(conversationId: string): Promise<Result> {
  const s = await createClient();
  const { error } = await s.rpc("comm_join_channel", { p_conv: conversationId });
  if (error) return fail(commErrorText(error, "That channel could not be joined."));
  revHub();
  return { ok: true };
}

/** Leave a group or channel. You keep what was said before you left. */
export async function leaveConversation(conversationId: string): Promise<Result> {
  const me = await getAppUser();
  if (!me) return fail("You are signed out.");
  const s = await createClient();
  const { error } = await s.rpc("comm_remove_member", { p_conv: conversationId, p_user: me.id });
  if (error) return fail(commErrorText(error, "You could not leave this conversation."));
  revHub();
  return { ok: true };
}

export async function addMembers(conversationId: string, userIds: string[]): Promise<Result & { added?: number }> {
  const parsed = memberIdsInput.safeParse({ conversation_id: conversationId, user_ids: userIds });
  if (!parsed.success) return fail("Pick at least one person to add.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_add_members", {
    p_conv: parsed.data.conversation_id,
    p_user_ids: parsed.data.user_ids,
  });
  if (error) return fail(commErrorText(error, "Those people could not be added."));
  await writeAudit({
    action: "comm.members_added",
    entityType: "comm_conversation",
    entityId: parsed.data.conversation_id,
    metadata: { user_ids: parsed.data.user_ids, added: data },
  });
  revHub();
  return { ok: true, added: (data as number) ?? 0 };
}

export async function removeMember(conversationId: string, userId: string): Promise<Result> {
  const s = await createClient();
  const { error } = await s.rpc("comm_remove_member", { p_conv: conversationId, p_user: userId });
  if (error) return fail(commErrorText(error, "That person could not be removed."));
  await writeAudit({
    action: "comm.member_removed",
    entityType: "comm_conversation",
    entityId: conversationId,
    metadata: { user_id: userId },
  });
  revHub();
  return { ok: true };
}

export async function setMemberRole(conversationId: string, userId: string, role: string): Promise<Result> {
  const parsed = memberRoleInput.safeParse({ conversation_id: conversationId, user_id: userId, role });
  if (!parsed.success) return fail("Unknown role.");
  const s = await createClient();
  const { error } = await s.rpc("comm_set_member_role", {
    p_conv: parsed.data.conversation_id,
    p_user: parsed.data.user_id,
    p_role: parsed.data.role,
  });
  if (error) return fail(commErrorText(error, "The role could not be changed."));
  await writeAudit({
    action: "comm.member_role",
    entityType: "comm_conversation",
    entityId: parsed.data.conversation_id,
    metadata: { user_id: parsed.data.user_id, role: parsed.data.role },
  });
  revHub();
  return { ok: true };
}

/** Add the linked department's logins. Adds only; never re-adds someone removed. */
export async function syncDepartmentMembers(conversationId: string): Promise<Result & { added?: number }> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_sync_department_members", { p_conv: conversationId });
  if (error) return fail(commErrorText(error, "The department's people could not be added."));
  await writeAudit({
    action: "comm.department_synced",
    entityType: "comm_conversation",
    entityId: conversationId,
    metadata: { added: data },
  });
  revHub();
  return { ok: true, added: (data as number) ?? 0 };
}

export async function setMuted(conversationId: string, muted: boolean): Promise<Result> {
  const s = await createClient();
  const { error } = await s.rpc("comm_set_muted", { p_conv: conversationId, p_muted: !!muted });
  if (error) return fail(commErrorText(error, "That could not be changed."));
  return { ok: true };
}

/** Move the read marker forward to `until` (default now). Not revalidated — a badge, not a page. */
export async function markRead(conversationId: string, until?: string | null): Promise<Result> {
  const s = await createClient();
  const { error } = await s.rpc("comm_mark_read", { p_conv: conversationId, p_until: until ?? null });
  if (error) return fail(commErrorText(error, "The conversation could not be marked read."));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Send. RETRY-SAFE: the browser mints `client_id` once per typed message and
 * resends the same one after a failure, so a send that reached the database
 * before the connection dropped is returned (`created: false`), not doubled.
 */
export async function sendMessage(input: SendMessageInput): Promise<SendResult> {
  const parsed = sendMessageInput.safeParse(input);
  if (!parsed.success) return fail("That message could not be read.");
  const d = parsed.data;
  const body = d.body && d.body.trim() ? d.body : null;
  if (!body && d.attachments.length === 0) return fail("Type a message or attach a file.");

  const me = await getAppUser();
  if (!me) return fail("You are signed out.");
  // Per-instance only (lib/rate-limit.ts says so); it stops a stuck key or a
  // script, it is not the guard. 30 sends in 10 s is far past any typist.
  if (!allow(`comm-send:${me.id}`, 30, 10_000)) return fail("You are sending too fast. Wait a moment.");

  const s = await createClient();
  const { data, error } = await s.rpc("comm_send_message", {
    p_conv: d.conversation_id,
    p_client_id: d.client_id,
    p_body: body,
    p_parent_id: d.parent_id,
    p_attachments: d.attachments,
  });
  if (error || !data) return fail(commErrorText(error, "The message was not sent. Try again."));
  const r = data as { id: string; created: boolean; created_at: string; mentioned: string[] };
  return { ok: true, id: r.id, created_at: r.created_at, created: r.created };
}

export async function editMessage(messageId: string, body: string): Promise<Result> {
  const parsed = editMessageInput.safeParse({ message_id: messageId, body });
  if (!parsed.success) return fail("That message could not be read.");
  const s = await createClient();
  const { error } = await s.rpc("comm_edit_message", { p_message: parsed.data.message_id, p_body: parsed.data.body });
  if (error) return fail(commErrorText(error, "The message could not be edited."));
  return { ok: true };
}

/**
 * Delete (soft). The RPC decides who may, clears the row, and hands back the
 * attachment keys; only THEN are the bytes removed — with the service role,
 * because the bucket deliberately has no DELETE policy. A key reaches the admin
 * client only after Postgres has confirmed this caller may delete its message.
 */
export async function deleteMessage(messageId: string): Promise<Result> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_delete_message", { p_message: messageId });
  if (error) return fail(commErrorText(error, "The message could not be deleted."));
  const paths = ((data as { paths?: string[] } | null)?.paths ?? []).filter((p) => typeof p === "string");
  if (paths.length > 0) {
    // Best effort: the row is already gone, so a failure here leaves orphaned
    // bytes nobody can reach (comm_can_read_file finds no attachment row), not
    // a visible attachment. Logged rather than surfaced.
    const { error: rmErr } = await createAdminClient().storage.from(COMM_BUCKET).remove(paths);
    if (rmErr) console.error("comm: attachment bytes not removed", rmErr.message);
  }
  await writeAudit({
    action: "comm.message_deleted",
    entityType: "comm_message",
    entityId: messageId,
    metadata: { attachments: paths.length },
  });
  return { ok: true };
}

export async function toggleReaction(messageId: string, emoji: string): Promise<Result & { on?: boolean }> {
  const parsed = reactionInput.safeParse({ message_id: messageId, emoji });
  if (!parsed.success) return fail("That reaction cannot be used.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_toggle_reaction", {
    p_message: parsed.data.message_id,
    p_emoji: parsed.data.emoji,
  });
  if (error) return fail(commErrorText(error, "The reaction was not saved."));
  return { ok: true, on: data === true };
}

export async function setPinned(messageId: string, pinned: boolean): Promise<Result> {
  const s = await createClient();
  const { error } = await s.rpc("comm_set_pin", { p_message: messageId, p_pinned: !!pinned });
  if (error) return fail(commErrorText(error, "The pin was not changed."));
  return { ok: true };
}

/** Saved messages are your own bookmarks — the one direct-write table (0737). */
export async function setSaved(messageId: string, saved: boolean): Promise<Result> {
  const me = await getAppUser();
  if (!me) return fail("You are signed out.");
  const s = await createClient();
  const { error } = saved
    ? await s.from("comm_saved").upsert({ user_id: me.id, message_id: messageId }, { onConflict: "user_id,message_id", ignoreDuplicates: true })
    : await s.from("comm_saved").delete().eq("user_id", me.id).eq("message_id", messageId);
  if (error) return fail(saved ? "That message could not be saved." : "That message could not be removed from saved.");
  revalidatePath("/comms/saved");
  return { ok: true };
}

/**
 * A short-lived link to an attachment. Signed AS THE CALLER, so the bucket's
 * read policy (comm_can_read_file: you can read the message it is on) decides —
 * a guessed key signs nothing. 60 s, as file-attachments.tsx does: long enough
 * to open, too short to forward.
 */
export async function attachmentUrl(storagePath: string): Promise<{ ok: true; url: string } | Fail> {
  if (typeof storagePath !== "string" || !storagePath) return fail("That file could not be found.");
  const s = await createClient();
  const { data, error } = await s.storage.from(COMM_BUCKET).createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) return fail("That file could not be opened.");
  return { ok: true, url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Reads the screen calls after first paint (older pages, threads, pickers)
// ---------------------------------------------------------------------------

export async function loadMessages(
  conversationId: string,
  before: string | null,
): Promise<{ ok: true; page: MessagePage } | Fail> {
  try {
    return { ok: true, page: await getMessages(conversationId, before) };
  } catch {
    return fail("Older messages could not be loaded. Try again.");
  }
}

export async function loadThread(
  parentId: string,
): Promise<{ ok: true; parent: CommMessage; replies: CommMessage[] } | Fail> {
  try {
    const t = await getThread(parentId);
    if (!t) return fail("That thread could not be found.");
    return { ok: true, ...t };
  } catch {
    return fail("The thread could not be loaded. Try again.");
  }
}

export async function loadPinned(conversationId: string): Promise<{ ok: true; messages: CommMessage[] } | Fail> {
  try {
    return { ok: true, messages: await getPinned(conversationId) };
  } catch {
    return fail("Pinned messages could not be loaded. Try again.");
  }
}

export async function findPeople(query: string): Promise<{ ok: true; people: DirectoryPerson[] } | Fail> {
  try {
    return { ok: true, people: await searchDirectory(query, 20) };
  } catch {
    return fail("People could not be searched. Try again.");
  }
}

export async function findMessages(query: string): Promise<{ ok: true; hits: MessageHit[] } | Fail> {
  try {
    return { ok: true, hits: await searchMessages(query) };
  } catch {
    return fail("Messages could not be searched. Try again.");
  }
}
