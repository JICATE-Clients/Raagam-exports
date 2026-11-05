import { requirePermission } from "@/lib/auth/server";
import { listMyConversations, searchDirectory } from "@/lib/comms/service";
import { NewMessage, type QuickPick } from "@/components/comms/new-message";
import type { DirectoryPerson } from "@/lib/comms/types";

/**
 * Pulse ▸ New (/comms/new): the New message screen (To: a #channel or colleagues), beside
 * the sidebar the hub frame draws (comms-shell.tsx, "PULSE IS TWO PANES").
 * On a phone the frame shows only the sidebar here, and its ✎ opens the
 * tap-a-person sheet instead. The channels offered in To: are the ones the
 * person is in — the same cached read the layout's sidebar uses.
 *
 * RECENT AND PEOPLE (user 2026-11-02, "compact this page"): the pane's empty
 * middle lists who to write to. Recent is the caller's own latest direct chats
 * and channels, from the conversation read already made; People is the first
 * page of the same `comm_directory` the To: search uses.
 *
 * MOVED FROM /comms ON 2026-11-05 (user, artifact "Pulse – Home by default"):
 * /comms is now the Home feed; the "＋ New" pill on the list opens this.
 */
export default async function CommsNewMessagePage() {
  const [user, conversations] = await Promise.all([requirePermission("communication", "view"), listMyConversations()]);
  const channels = conversations
    .filter((c) => c.kind === "channel" && !c.is_archived)
    .map((c) => ({ id: c.id, name: c.title.replace(/^#/, ""), visibility: c.visibility, topic: c.topic }));

  const recent: QuickPick[] = conversations
    .filter((c) => !c.archived && !c.is_archived && c.last_message_at && (c.kind === "channel" || (c.kind === "direct" && c.other_user_id)))
    .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))
    .slice(0, 4)
    .map((c) =>
      c.kind === "channel"
        ? {
            kind: "channel",
            id: c.id,
            label: c.title.replace(/^#/, ""),
            sub: `Channel · ${c.member_count} ${c.member_count === 1 ? "member" : "members"}`,
            visibility: c.visibility,
          }
        : { kind: "person", id: c.other_user_id as string, label: c.title, sub: "Direct chat" },
    );

  // The directory is a nicety here: if it cannot be read, the pane still works
  // through To:, so a failure shows no People rather than breaking the page.
  let directory: DirectoryPerson[] = [];
  try {
    directory = await searchDirectory(null, 12);
  } catch {
    directory = [];
  }
  const inRecent = new Set(recent.filter((r) => r.kind === "person").map((r) => r.id));
  const people: QuickPick[] = directory
    .filter((p) => p.id !== user.id && !inRecent.has(p.id))
    .slice(0, 6)
    .map((p) => ({
      kind: "person",
      id: p.id,
      label: p.full_name,
      sub: [p.designation, p.department].filter(Boolean).join(" · ") || null,
    }));

  return <NewMessage channels={channels} meId={user.id} recent={recent} people={people} />;
}
