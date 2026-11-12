import { requirePermission } from "@/lib/auth/server";
import { getMentionsPage, isCommsMissing } from "@/lib/comms/service";
import { CommsNotInstalled } from "@/components/comms/comms-not-installed";
import { MentionsView } from "@/components/comms/mentions-view";

/**
 * Pulse ▸ Mentions (user 2026-11-06, artifact "Pulse: fixing the Mentions
 * shortcut", option A) — the messages that @mention you, newest first, each one
 * click from the chat it is in. The shortcut used to open Notifications, which
 * lists every alert, while its badge counted only mentions.
 *
 * `?show=all` lists every mention; the default is Unread, the same set the
 * shortcut's badge counts.
 */
export default async function MentionsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [user, sp] = await Promise.all([requirePermission("communication", "view"), searchParams]);
  const unreadOnly = sp.show !== "all";
  let page;
  try {
    page = await getMentionsPage({ unreadOnly });
  } catch (e) {
    if (isCommsMissing(e)) return <CommsNotInstalled migrations={["supabase/migrations/0737_communication_hub_core.sql"]} />;
    throw e;
  }
  return <MentionsView key={unreadOnly ? "unread" : "all"} unreadOnly={unreadOnly} initial={page.items} initialNext={page.next} meId={user.id} />;
}
