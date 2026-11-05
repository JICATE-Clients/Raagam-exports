import { requirePermission } from "@/lib/auth/server";
import { listMyConversations } from "@/lib/comms/service";
import { HomeFeed } from "@/components/comms/home-feed";

/**
 * Pulse ▸ Home (user 2026-11-05, artifact "Pulse – Home by default"): the feed
 * of every chat's latest message, beside the chat list (comms-shell.tsx,
 * "PULSE IS TWO PANES"). The New message screen moved to /comms/new. On a
 * phone the frame shows only the chat list here, as before.
 */
export default async function CommsHomePage() {
  await requirePermission("communication", "view");
  const conversations = await listMyConversations();
  return <HomeFeed conversations={conversations} />;
}
