import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { HubPage, type HubCardSpec } from "@/components/shell/group-hub";
import { MODULE_GROUPS } from "@/lib/nav/module-groups";
import { hubCounts } from "@/lib/nav/hub-counts";

/**
 * A MODULE's landing page: one card per sub-module, from the same registry the
 * sidebar reads.
 *
 * ## Why this exists
 *
 * `GroupHub` beside it solved the problem one level down — 37 sub-module hubs,
 * all four lines, all rendering `lib/nav/module-groups.ts`, so a screen cannot
 * be on a hub and missing from the sidebar. Nothing did the same for the level
 * ABOVE, and the result was that `/masters` was the only module root in the app
 * listing its sub-modules. Every other one hand-wrote a grid of LEAF screens:
 * `/planning` offered 19 cards against 5 registered groups, `/hr` 14 against 4,
 * `/purchase` 10 against 3, and `/orders` showed an order list instead.
 *
 * Those grids are the failure this file's neighbour already records — "the nav
 * list and the landing grid were once two hand-edited literals nothing kept in
 * sync" — and they had already rotted: `/planning`'s root offers all 19 of its
 * screens as working while the registry marks every one of them `unavailable`.
 *
 * The rot is not only in the CONTENT. Only `/masters` rendered through
 * `HubPage`; the others reach for a raw `Card`, so they silently lost the
 * `unavailable` state, the record counts and the "N screens" glyph. A duplicated
 * list drifts in capability as well as in facts, and that half is invisible
 * until a card lies.
 *
 * ## What a card is here
 *
 * A SUB-MODULE, never a screen. That is the shape `/masters` has always had and
 * the one `lib/nav/module-groups.ts` states as the rule: two levels in the
 * sidebar, the third on the page. A module root that lists leaves flattens the
 * middle level away and leaves the groups reachable only from the sidebar.
 *
 * So a group card counts SCREENS (`children.length`, the same figure
 * `GroupHub` shows for a card that opens another hub) and a `link` entry —
 * a standalone screen with no siblings worth grouping — counts RECORDS, from
 * the one count source. Orders has no links today; Planning's Budgets is one.
 *
 * `hidden` is honoured HERE AS WELL as in `moduleNavChildren`. It was the only
 * reader that filtered the flag, which was correct while the module roots were
 * hand-written literals and is not correct now: a hidden group has no sidebar
 * row, and a card for it on the module's own landing page would put the row
 * straight back, one level over, which is precisely what hiding it was for.
 */
export async function ModuleHub({ moduleHref }: { moduleHref: string }) {
  const grouping = MODULE_GROUPS[moduleHref];
  if (!grouping) notFound();

  await requirePermission(grouping.module, "view");

  // Same order as `GroupHub`: gate first, count after. A count is a fact about
  // records this caller may not be allowed to see, and `hub_record_counts` is
  // SECURITY INVOKER so RLS decides that — counting first would leak the size
  // of a table to someone refused the page above it.
  const entries = grouping.entries.filter(
    (e) => !(e.kind === "group" && e.hidden),
  );
  const links = entries.filter((e) => e.kind === "link");
  const resolved = links.length ? await hubCounts(links) : new Map<string, number>();

  const cards: HubCardSpec[] = entries.map((e) =>
    e.kind === "group"
      ? {
          key: e.slug,
          href: `${moduleHref}/${e.slug}`,
          label: e.label,
          description: e.description,
          // Screens, not records — a hub has no table of its own. `hub: true`
          // is what gives the tile its LayoutGrid glyph and chevron, so the
          // operator can see it opens a list before clicking it.
          count: e.children.length,
          hub: true,
          // A group still being settled reads as provisional here too, rather
          // than only once the operator is already inside it.
          dashed: e.status === "provisional",
        }
      : {
          key: e.href,
          // An unavailable link is INERT, exactly as an unavailable card is: its
          // route exists and its service swallows the missing-relation error and
          // returns [], so following it lands the operator on a clean, empty,
          // finished-looking screen. Sending them there is the failure this
          // state was added to end.
          href: e.status === "unavailable" ? null : e.href,
          label: e.label,
          // A `ModuleLink` carries no description — it is a bare row in the
          // sidebar. Absent, not invented: a made-up subtitle on a landing page
          // is the kind of claim these grids were drifting into. An unavailable
          // one says WHY instead, which is not something a greyed tile conveys.
          description:
            e.status === "unavailable"
              ? (e.unavailableNote ?? "Not available in this database")
              : "",
          unavailable: e.status === "unavailable",
          count: e.status === "unavailable" ? undefined : resolved.get(e.href),
        },
  );

  return (
    <HubPage
      title={grouping.label}
      description={grouping.description ?? `${cards.length} sub-modules`}
      cards={cards}
    />
  );
}
