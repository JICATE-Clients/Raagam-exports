import { requirePermission } from "@/lib/auth/server";
import { searchMessages } from "@/lib/comms/service";
import { MessageHitList } from "@/components/comms/message-hit-list";
import { SearchBox } from "./search-box";

/**
 * Search every message the caller can read. RLS scopes the query, so a result
 * can never come from a conversation they are not in.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 200);
  const [user, hits] = await Promise.all([requirePermission("communication", "view"), query.length >= 2 ? searchMessages(query) : Promise.resolve([])]);
  return (
    <MessageHitList
      title="Search messages"
      hits={hits}
      meId={user.id}
      toolbar={<SearchBox initial={query} />}
      empty={query.length < 2 ? "Type at least two characters to search." : `No messages match “${query}”.`}
    />
  );
}
