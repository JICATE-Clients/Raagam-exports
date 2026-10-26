import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";

/**
 * Who hears about a message (spec §6), through the EXISTING `notify()` — one
 * notifications table, one bell, one push fan-out, one admin switch per event.
 *
 *   * `comms.mention` — everyone the database says was mentioned. Those ids
 *     come back from `comm_send_message` / `comm_edit_message`, which keep only
 *     ACTIVE MEMBERS of the conversation, so a mention can never notify an
 *     outsider or reveal a private conversation to one. Sent even to a member
 *     who muted the conversation: being named is the point of a mention.
 *   * `comms.direct_message` — the other people in a DM or group, unless they
 *     muted it or were just mentioned (one alert, not two). Channels alert on
 *     mentions only: a channel is read when you choose to, not pushed.
 *
 * ONE UNREAD ALERT PER CONVERSATION. A colleague sending eight quick lines
 * must not buzz a phone eight times: anyone who still has an UNREAD
 * comms.direct_message for this conversation is skipped. Reading it (the bell,
 * or opening the conversation's notifications page) re-arms the next one.
 *
 * NO MESSAGE TEXT IN THE ALERT (spec §8: "avoid copying … contents into
 * notification payloads"). A notification row outlives the message — it
 * survives an edit, a delete, and the reader being removed from the
 * conversation — so it says who and where, and the link re-checks access when
 * it opens.
 *
 * EVERY ALERT IS KEYED ON THE MESSAGE ID (`dedupeKey`, 0746), so a retried send
 * or an edit that re-mentions someone cannot alert anyone twice.
 */
export async function notifyForMessage(args: {
  conversationId: string;
  messageId: string;
  /** Only ids the RPC returned — never parsed from the body here. */
  mentioned: string[];
  senderId: string;
  senderName: string | null;
  /** False for an edit: an edit never re-sends the DM alert. */
  isNewMessage: boolean;
}): Promise<void> {
  const { conversationId, messageId, senderId } = args;
  const href = `/comms/c/${conversationId}`;
  const who = args.senderName?.trim() || "Someone";

  // Read AS THE SENDER: RLS returns this conversation only because they are in it.
  const s = await createClient();
  const [convR, memR] = await Promise.all([
    s.from("comm_conversations").select("kind, name").eq("id", conversationId).maybeSingle(),
    s.from("comm_members").select("user_id, muted").eq("conversation_id", conversationId).is("removed_at", null),
  ]);
  if (convR.error || !convR.data || memR.error) return;
  const conv = convR.data as { kind: "direct" | "group" | "channel"; name: string | null };
  const members = (memR.data ?? []) as { user_id: string; muted: boolean }[];
  const active = new Set(members.map((m) => m.user_id));

  const where =
    conv.kind === "channel" ? `in #${conv.name ?? "channel"}` : conv.kind === "group" ? `in ${conv.name?.trim() || "a group"}` : "in a direct message";

  const mentioned = [...new Set(args.mentioned)].filter((u) => u !== senderId && active.has(u));
  if (mentioned.length > 0) {
    await notify(
      "comms.mention",
      { userIds: mentioned },
      { title: `${who} mentioned you`, body: where, href, type: "info" },
      { dedupeKey: messageId, actorId: senderId, fallbackToAdmins: false },
    );
  }

  if (!args.isNewMessage || conv.kind === "channel") return;

  let recipients = members
    .filter((m) => m.user_id !== senderId && !m.muted && !mentioned.includes(m.user_id))
    .map((m) => m.user_id);
  if (recipients.length === 0) return;

  // Collapse: skip anyone still holding an unread alert for this conversation.
  // Other people's notification rows are not readable as the sender, so this
  // one read is the service role's — it reads ids only, and only to skip.
  const { data: open } = await createAdminClient()
    .from("notifications")
    .select("user_id")
    .eq("event_key", "comms.direct_message")
    .eq("href", href)
    .is("read_at", null)
    .in("user_id", recipients);
  const waiting = new Set(((open ?? []) as { user_id: string }[]).map((r) => r.user_id));
  recipients = recipients.filter((u) => !waiting.has(u));
  if (recipients.length === 0) return;

  await notify(
    "comms.direct_message",
    { userIds: recipients },
    {
      title: conv.kind === "direct" ? `New message from ${who}` : `${who} ${where}`,
      body: conv.kind === "direct" ? "Direct message" : "New message",
      href,
      type: "info",
    },
    { dedupeKey: messageId, actorId: senderId, fallbackToAdmins: false },
  );
}
