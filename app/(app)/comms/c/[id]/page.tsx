import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { getConversation, getMessages } from "@/lib/comms/service";
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
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, conversation] = await Promise.all([requirePermission("communication", "view"), getConversation(id)]);
  if (!conversation) notFound();
  const [page, canModerate] = await Promise.all([getMessages(id), can("communication", "delete")]);
  return (
    <ConversationView
      key={id}
      conversation={conversation}
      initialPage={page}
      meId={user.id}
      canModerate={canModerate}
    />
  );
}
