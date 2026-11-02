import { requirePermission } from "@/lib/auth/server";
import { listMyConversations } from "@/lib/comms/service";
import { NewMessage } from "@/components/comms/new-message";

/**
 * Pulse's home: the New message screen (To: a #channel or colleagues), beside
 * the sidebar the hub frame draws (comms-shell.tsx, "PULSE IS TWO PANES").
 * On a phone the frame shows only the sidebar here, and its ✎ opens the
 * tap-a-person sheet instead. The channels offered in To: are the ones the
 * person is in — the same cached read the layout's sidebar uses.
 */
export default async function CommsHomePage() {
  const [user, conversations] = await Promise.all([requirePermission("communication", "view"), listMyConversations()]);
  const channels = conversations
    .filter((c) => c.kind === "channel" && !c.is_archived)
    .map((c) => ({ id: c.id, name: c.title.replace(/^#/, ""), visibility: c.visibility, topic: c.topic }));
  return <NewMessage channels={channels} meId={user.id} />;
}
