// Relative, the same way `hub-counts.ts` imports its sibling map.
import { MODULE_GROUPS } from "./module-groups";

/** Where a screen's "← Back to …" goes, and what it is called. */
export interface BackTarget {
  href: string;
  label: string;
}

/**
 * The screen ABOVE this one — the sub-module hub a listing sits inside, or the
 * module hub for a standalone row. `null` when there is nothing to go back to.
 *
 * ## Why this is derived rather than declared
 *
 * A child listing screen had no way back to the hub it was opened from (client
 * 2026-08-17). 88 of the 118 registered leaf screens rendered a `PageHeader`
 * with no back affordance of any kind; the operator's only routes out were the
 * browser's own Back and the sidebar. The other 30 each hand-rolled one, and
 * they had already drifted three ways — `Back to list`, `← Back to list`,
 * `← {sub.label}` — which is the same fan-out `data-io-toolbar.tsx` records
 * ("the fan-out is always on the hand-rolled half"). Answering that with an
 * 88th copy of a `<Link>` is not a fix.
 *
 * The parent is ALREADY WRITTEN DOWN: `lib/nav/module-groups.ts` is the one
 * registry the sidebar, every hub page and nav search all read. Deriving from
 * it means a screen that moves group moves its own Back with it, and a new
 * screen is correct the day it is registered — with nothing to keep in sync.
 * That is `owningNavHref`'s argument, one step further: it answers "which
 * sidebar row is lit", this answers "where does ← go".
 *
 * ## Four routes deliberately answer `null`
 *
 * Each is a place that ALREADY has a way back, so an automatic second one would
 * be a duplicate rather than a fix:
 *
 * - **A module root** (`/orders`). It is the top of its own trail, and the
 *   sidebar row is where it came from.
 * - **A group hub** (`/orders/order-setup`). `HubPage` renders a breadcrumb.
 * - **A route BENEATH a leaf** (`/purchase/grn/{id}`). The match is EXACT, not a
 *   prefix, so a document's detail page is left alone — those keep their own
 *   "Back to list", which returns to the register rather than to the hub, and
 *   is the more useful of the two answers there.
 * - **A module with no registry entry** — `/masters`, `/sales`, `/reports`,
 *   `/analytics`. Master Data has carried a hand-rolled `← {sub.label}` plus a
 *   breadcrumb on every entity listing since it was written; Sales and Reports
 *   keep literal nav lists (`nav.ts`) and so have no parent to read here. A
 *   guess for those is worse than nothing.
 *
 * ## `unavailable` is INCLUDED, `cardOnly` and `todo` are not
 *
 * `moduleLeafItems` filters out every child with a `status`; this must not,
 * and the difference is the point. A `todo` child has no route, so no pathname
 * can equal it. An `unavailable` one DOES resolve — to a clean, empty table
 * over a table that is not in this database — and a screen that cannot do
 * anything is exactly where an operator most needs the way out.
 *
 * `cardOnly` is skipped for the reason `owningNavHref` skips it: that listing is
 * a second CARD, and its row lives in another group. Following it would send the
 * operator back to a hub that does not own the screen they were on.
 */
export function backTarget(pathname: string): BackTarget | null {
  const moduleHref = Object.keys(MODULE_GROUPS)
    .filter((m) => pathname === m || pathname.startsWith(m + "/"))
    .sort((a, b) => b.length - a.length)[0];
  if (!moduleHref) return null;

  const grouping = MODULE_GROUPS[moduleHref];
  if (pathname === moduleHref) return null;

  // Hub routes first, as a SET rather than inside the scan below. A group slug
  // may also appear as a card on a sibling hub (`/orders/changes` is a card on
  // Garment Orders), so testing it entry-by-entry would depend on which entry
  // the loop reached first — a hub would get a Back or not according to
  // registry order.
  const hubRoutes = new Set(
    grouping.entries
      .filter((e) => e.kind === "group")
      .map((e) => `${moduleHref}/${(e as { slug: string }).slug}`),
  );
  if (hubRoutes.has(pathname)) return null;

  for (const e of grouping.entries) {
    if (e.kind === "link") {
      // A standalone row's parent IS the module — there is no sub-module
      // between them. `grouping.label` is held on the registry precisely so a
      // reader can name the module without importing `nav.ts`, which imports
      // this registry and would be a cycle.
      if (e.href === pathname) return { href: moduleHref, label: grouping.label };
      continue;
    }
    for (const c of e.children) {
      if (c.href !== pathname) continue;
      if (c.cardOnly) continue;
      if (c.status === "todo") continue;
      return { href: `${moduleHref}/${e.slug}`, label: e.label };
    }
  }
  return null;
}
