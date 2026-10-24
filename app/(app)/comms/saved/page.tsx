import { requirePermission } from "@/lib/auth/server";
import { getSaved } from "@/lib/comms/service";
import { MessageHitList } from "@/components/comms/message-hit-list";

/** Your saved messages — private bookmarks, newest save first. */
export default async function SavedPage() {
  const [user, hits] = await Promise.all([requirePermission("communication", "view"), getSaved()]);
  return (
    <MessageHitList
      title="Saved messages"
      hits={hits}
      meId={user.id}
      savedList
      empty="Nothing saved yet. Use the bookmark on any message to keep it here."
    />
  );
}
