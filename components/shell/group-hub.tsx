import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";
import { findGroup, groupAtRoute } from "@/lib/nav/module-groups";
import { hubCounts } from "@/lib/nav/hub-counts";

/**
 * href → record count, exactly the map `lib/nav/hub-counts.ts` returns.
 *
 * Declared structurally rather than imported so this component keeps rendering
 * with no count source at all: a missing entry is "unknown" and the card shows
 * no number. It must NOT collapse to `0` — `0` is a claim ("nothing here yet,
 * click to add") that a count which failed, or was never wired, is not making.
 */
type HubCountMap = ReadonlyMap<string, number>;

/** One tile, already resolved. What `HubPage` renders and `GroupHub` derives. */
export interface HubCardSpec {
  /** React key. Not the href: a `todo` card has none, and two cards may point
   *  at one route (a hub listing the screen its work starts on). */
  key: string;
  /** `null` for a card with nowhere to go — see `HubCard`. */
  href: string | null;
  label: string;
  description: string;
  count?: number | null;
  external?: boolean;
  dashed?: boolean;
  hub?: boolean;
  /** Built, but its table is not in this database. Greyed, never dashed. */
  unavailable?: boolean;
}

/**
 * The hub PAGE, from a caller-supplied card list: breadcrumb, header, an
 * optional note banner, and the card grid.
 *
 * Split out from `GroupHub` because the two hub families keep different
 * registries and neither is going to move. `GroupHub` looks its cards up in
 * `MODULE_GROUPS` by module + slug, which is right for the 37 sub-module hubs
 * and useless to the other four: Master Data has its own registry
 * (`lib/masters/submodules.ts`) with dynamic `/masters/[submodule]/[entity]`
 * routes, and Sales is deliberately absent from `MODULE_GROUPS` because
 * `nav.ts` keeps its literal list. A renderer that could only do the lookup
 * would have left those four hand-rolled — which is how `/masters/page.tsx` and
 * `/masters/[submodule]/page.tsx` came to render the same grid twice, with
 * `/masters/materials` drifting into a third copy that no longer matched either.
 *
 * It carries NO permission gate: a caller supplying its own cards is by
 * definition not reading `module` from the registry, so it owns that check.
 * `GroupHub` below still gates, from the same entry as its cards.
 */
export function HubPage({
  breadcrumb,
  title,
  description,
  note,
  status,
  cards,
}: {
  /** Omit on a module's own landing page, which is the top of its trail. */
  breadcrumb?: { href: string; label: string };
  title: string;
  description: string;
  /** Renders above the grid. Neutral on its own, amber when `status` is
   *  "provisional" — the same two fields `SubmoduleDef` and `ModuleGroup` both
   *  carry, rendered one way so the hubs explain themselves alike. */
  note?: string;
  status?: "provisional";
  cards: HubCardSpec[];
}) {
  return (
    <div className="space-y-4">
      {breadcrumb && (
        <nav className="text-xs text-muted-foreground">
          <Link href={breadcrumb.href} className="hover:text-primary">
            {breadcrumb.label}
          </Link>{" "}
          / <span className="text-foreground">{title}</span>
        </nav>
      )}
      <PageHeader title={title} description={description} />
      {note && (
        <div
          className={
            status === "provisional"
              ? "rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning"
              : "rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-muted-foreground"
          }
        >
          {note}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <HubCard
            key={c.key}
            href={c.href}
            title={c.label}
            subtitle={c.description}
            count={c.count}
            external={c.external}
            dashed={c.dashed}
            hub={c.hub}
            unavailable={c.unavailable}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A sub-module hub, driven by `lib/nav/module-groups.ts`.
 *
 * Every group page in the app is four lines around this component, and the
 * cards come from the registry the sidebar also reads. A screen therefore
 * cannot appear in one and go missing from the other.
 *
 * The permission gate lives here rather than in each page so a new hub cannot
 * ship ungated — `module` comes from the same registry entry as the cards.
 *
 * ## What a card says before it is clicked
 *
 * Three of the four states are declared on the child (`status: "todo"`,
 * `external`, `countKey`). The fourth — the card that opens ANOTHER hub — is
 * DERIVED by `groupAtRoute`, because the registry already knows: a card opens a
 * hub exactly when its href is a registered group of the same module. There is
 * one today, Garment Orders ▸ "Amendments", and it rendered identically to its
 * nine siblings, so it promised a screen and delivered another card list.
 *
 * `external` (↗) is reserved for a card that leaves the MODULE, and stays rare
 * on purpose: `/orders/ta` once passed it on all six of its own siblings, which
 * is what the glyph is not for.
 */
export async function GroupHub({
  moduleHref,
  slug,
  counts,
}: {
  moduleHref: string;
  slug: string;
  /**
   * OVERRIDE. Left out — which is the normal case, and what all 37 hub pages
   * do — the counts are fetched here, so wiring them was one edit rather than
   * 37. Supplied, it is used as-is and nothing is fetched.
   */
  counts?: HubCountMap;
}) {
  const found = findGroup(moduleHref, slug);
  if (!found) notFound();
  const { group, moduleLabel, module } = found;

  await requirePermission(module, "view");

  // AFTER the permission gate, never before: a count is a fact about records
  // this caller may or may not be allowed to see, and `hub_record_counts` is
  // SECURITY INVOKER precisely so RLS decides that. Counting first would leak
  // the size of a table to someone refused the page that shows it.
  const resolved = counts ?? (await hubCounts(group.children));

  const cards: HubCardSpec[] = group.children.map((c) => {
    const todo = c.status === "todo";
    const unavailable = c.status === "unavailable";
    const idle = todo || unavailable;
    const hub = groupAtRoute(moduleHref, c.href);
    return {
      key: c.href,
      // Neither state is a link, for DIFFERENT reasons. A `todo` child's route
      // does not exist — that is what the flag means and the check asserts it
      // both ways — so the tile's only behaviour would be a 404. An
      // `unavailable` child's route DOES exist, and that is worse: its service
      // swallows PostgREST's missing-relation error and returns `[]`, so the
      // operator lands on a clean, empty, finished-looking table. Sending them
      // there is the entire failure this state was added to end.
      href: idle ? null : c.href,
      label: c.label,
      // A screen that cannot be used has nothing to describe — the registry's
      // description would be a promise. `todo` reuses the wording
      // `/masters/[submodule]` has said since it was built; `unavailable` says
      // WHY, because "built, but its table is not in this database" is not
      // something an operator can infer from a greyed tile.
      description: todo
        ? "Not set up yet"
        : unavailable
          ? c.unavailableNote ?? "Not available in this database"
          : c.description,
      dashed: todo,
      unavailable,
      external: c.external,
      hub: !!hub,
      // Neither carries a count, and it is one reason for both: `0` is a claim —
      // "nothing here yet, click to add" — and neither a missing screen nor a
      // missing table is making it. A hub card counts SCREENS, which the
      // registry already holds; only a real screen asks the count source, and
      // gets `undefined` (not `0`) when it has no answer — absent is not zero,
      // and `HubCard` renders the two differently on purpose.
      count: idle ? undefined : hub ? hub.children.length : resolved.get(c.href),
    };
  });

  return (
    <HubPage
      breadcrumb={{ href: moduleHref, label: moduleLabel }}
      title={group.label}
      description={group.description}
      note={group.note}
      status={group.status}
      cards={cards}
    />
  );
}
