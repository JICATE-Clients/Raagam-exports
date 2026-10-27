import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { getConversation, getMessages } from "@/lib/comms/service";
import { channelAbilities } from "@/lib/comms/channel-service";
import type { ChannelAbilities } from "@/lib/comms/channels";
import { ConversationView } from "@/components/comms/conversation-view";

/**
 * One conversation. `getConversation` reads through RLS, so an id the caller
 * may not see — a private channel, someone else's DM, a guessed uuid — comes
 * back null and renders not-found, indistinguishable from an id that does not
 * exist (spec §10: guessed IDs and direct URLs).
 *
 * `key={id}` on the view: switching conversations remounts it, so no state —
 * pending sends, an open thread, a scroll position — leaks from one into the next.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** 0762: ?m=<message> opens AT that message; ?t=<thread parent> opens its thread. */
  searchParams: Promise<{ m?: string; t?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const focus = sp.m && UUID.test(sp.m) ? { messageId: sp.m, threadParentId: sp.t && UUID.test(sp.t) ? sp.t : null } : null;
  const [user, conversation] = await Promise.all([requirePermission("communication", "view"), getConversation(id)]);
  if (!conversation) notFound();
  const [page, canModerate, abilities] = await Promise.all([
    getMessages(id),
    can("communication", "delete"),
    // A channel's settings are drawn from what the caller may do (0751). Before
    // 0751 is applied the read fails and the older details sheet is used.
    conversation.kind === "channel"
      ? channelAbilities(id).catch((): ChannelAbilities | null => null)
      : Promise.resolve(null),
  ]);
  return (
    <ConversationView
      key={id}
      conversation={conversation}
      initialPage={page}
      meId={user.id}
      canModerate={canModerate}
      abilities={abilities}
      focus={focus}
    />
  );
}
