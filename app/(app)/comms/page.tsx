import { listMyConversations } from "@/lib/comms/service";
import { ConversationList } from "@/components/comms/conversation-list";

/**
 * Chats — the hub's home: the person's conversations, full width. The hub frame
 * no longer draws a list beside every view (user 2026-10-26), so this page is
 * where a conversation is picked. `communication:view` is checked by the layout.
 */
export default async function CommsHomePage() {
  return <ConversationList conversations={await listMyConversations()} />;
}
