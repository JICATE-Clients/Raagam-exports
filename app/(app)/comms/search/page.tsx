import { requirePermission } from "@/lib/auth/server";
import { isCommsMissing, searchHuddle, type SearchOutcome } from "@/lib/comms/service";
import { channelOptions, discoverChannels } from "@/lib/comms/channel-service";
import { getPerson, listPeople } from "@/lib/comms/workspace-service";
import { SEARCH_KINDS, SEARCH_SORTS, isDay, parseQuery, searchInput, type SearchKind, type SearchSort } from "@/lib/comms/search";
import { CommsNotInstalled } from "@/components/comms/comms-not-installed";
import { SearchView, type SearchState } from "@/components/comms/search-view";

type Params = { q?: string; from?: string; in?: string; after?: string; before?: string; file?: string; kind?: string; sort?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Huddle ▸ Search (0762). The search lives in the URL — the words, every
 * filter and the sort — so a search can be refreshed, shared, and come back
 * exactly when the operator returns from a result. The first page is read
 * here; "Load more" pages through the same function (lib/comms/search-actions.ts).
 *
 * Messages are found by comm_search_messages, which runs AS THE CALLER, so RLS
 * decides every result. People and channels come from the directory and from
 * channel discovery — the same reads People and Channels use — so nothing
 * appears here that those screens would not show this person.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [user, sp] = await Promise.all([requirePermission("communication", "view"), searchParams]);
  const state: SearchState = {
    q: (sp.q ?? "").slice(0, 200),
    author: sp.from && UUID.test(sp.from) ? sp.from : null,
    conversation: sp.in && UUID.test(sp.in) ? sp.in : null,
    fromDay: sp.after && isDay(sp.after) ? sp.after : null,
    toDay: sp.before && isDay(sp.before) ? sp.before : null,
    hasFile: sp.file === "1",
    kind: (SEARCH_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as SearchKind) : null,
    sort: (SEARCH_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as SearchSort) : "relevance",
  };
  const parsed = parseQuery(state.q);
  const anyFilter = !!(state.author || state.conversation || state.fromDay || state.toDay || state.hasFile || state.kind);
  const searching = parsed.text.length > 0 || anyFilter || parsed.from.length + parsed.in.length > 0 || parsed.hasFile || !!parsed.fromDay || !!parsed.toDay || parsed.thread;

  let outcome: SearchOutcome | null = null;
  let channels: { id: string; name: string; visibility: string }[] = [];
  let people: Awaited<ReturnType<typeof listPeople>>["rows"] = [];
  let foundChannels: Awaited<ReturnType<typeof discoverChannels>>["rows"] = [];
  let authorName: string | null = null;
  try {
    const valid = searchInput.safeParse(state);
    [outcome, channels, people, foundChannels, authorName] = await Promise.all([
      searching && valid.success ? searchHuddle(valid.data) : Promise.resolve(null),
      channelOptions(),
      // People and channels match the plain WORDS, not the operators.
      parsed.text.length >= 2 ? listPeople(parsed.text, "active").then((r) => r.rows.slice(0, 5)) : Promise.resolve([]),
      parsed.text.length >= 2 ? discoverChannels(parsed.text, "active", 0).then((r) => r.rows.slice(0, 5)) : Promise.resolve([]),
      state.author ? getPerson(state.author).then((p) => p?.full_name ?? null).catch(() => null) : Promise.resolve(null),
    ]);
  } catch (e) {
    if (isCommsMissing(e)) {
      return (
        <CommsNotInstalled
          migrations={["supabase/migrations/0751_comms_channel_management.sql", "supabase/migrations/0762_comms_message_search.sql"]}
        />
      );
    }
    throw e;
  }

  return (
    <SearchView
      key={JSON.stringify(state)}
      state={state}
      meId={user.id}
      searching={searching}
      outcome={outcome}
      channels={channels}
      people={people}
      foundChannels={foundChannels}
      authorName={authorName}
    />
  );
}
