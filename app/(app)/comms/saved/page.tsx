import { requirePermission } from "@/lib/auth/server";
import { getSavedPage, isCommsMissing } from "@/lib/comms/service";
import { channelOptions } from "@/lib/comms/channel-service";
import { SEARCH_KINDS, type SearchKind } from "@/lib/comms/search";
import { CommsNotInstalled } from "@/components/comms/comms-not-installed";
import { SavedView, type SavedFilters } from "@/components/comms/saved-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Your saved messages — private bookmarks, newest save first (0737, paged and
 * filtered since 0763). The filters live in the URL and are applied by the
 * database; "Load more" pages through the same read.
 */
export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; in?: string; kind?: string; file?: string }>;
}) {
  const [user, sp] = await Promise.all([requirePermission("communication", "view"), searchParams]);
  const filters: SavedFilters = {
    q: (sp.q ?? "").slice(0, 200),
    conversation: sp.in && UUID.test(sp.in) ? sp.in : null,
    kind: (SEARCH_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as SearchKind) : null,
    hasFile: sp.file === "1",
  };
  let loaded;
  try {
    loaded = await Promise.all([getSavedPage(filters), channelOptions()]);
  } catch (e) {
    if (isCommsMissing(e)) return <CommsNotInstalled migrations={["supabase/migrations/0763_comms_saved_list.sql"]} />;
    throw e;
  }
  const [page, channels] = loaded;
  return (
    <SavedView
      key={JSON.stringify(filters)}
      filters={filters}
      initial={page.items}
      initialNext={page.next}
      channels={channels}
      meId={user.id}
    />
  );
}
