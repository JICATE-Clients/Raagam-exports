import { BadgeCheck, Boxes, IndianRupee, Layers, ShoppingCart } from "lucide-react";
import type { HubMark } from "@/components/masters/hub-icons";

/**
 * WHICH ICON A `GroupHub` CARD DRAWS, keyed by `href`.
 *
 * `components/masters/hub-icons.ts` solved this once already for the OTHER
 * hub family (`HubPage`/Master Data's `/masters/[submodule]`) — a name (there,
 * a slug) resolved to a `{icon, tone}` pair so the registry that feeds the
 * page stays plain data. This is the same mechanism for `GroupHub`'s ~37
 * sub-module hubs, which read `lib/nav/module-groups.ts` instead of
 * `lib/masters/submodules.ts`.
 *
 * KEYED BY `href`, NOT BY SLUG. A `GroupHub` child's `key` is already its
 * `href` (`group-hub.tsx`: "React key. Not the href: a todo card has none...").
 * Hrefs are globally unique across every module by construction; a bare slug
 * is not (`customer` names a row in both Associates and, in principle, some
 * future Orders group) — so this map sidesteps that collision entirely rather
 * than needing a second, module-qualified key shape.
 *
 * FILLED IN ONE HUB AT A TIME, same as the Master Data map: an href absent
 * here draws the house default (`Tag`), never an error, so this can grow
 * hub-by-hub as each is asked for rather than needing every `GroupHub`
 * populated before any of them look right.
 *
 * `lib/nav/module-groups.ts` itself carries no `icon` field, deliberately —
 * that file already states why it stays plain hrefs/labels (imported by
 * `nav.ts`, `nav-search.ts` and `scripts/check-module-groups.mts`, none of
 * which want a `lucide-react` dependency for a lookup they never use).
 */
export const GROUP_HUB_ICONS: Readonly<Record<string, HubMark>> = {
  // Orders ▸ Order Management (client 2026-09-07: "why not yet updated
  // icons" — the same tag repeated five times). Read top to bottom as the
  // five steps a bulk order passes through; tones simply distinguish
  // neighbours, the same rule the Master Data map states for its own grid.
  "/orders/garment-orders": { icon: ShoppingCart, tone: "primary" },
  "/orders/material-bom": { icon: Layers, tone: "info" },
  "/orders/fabric-bom": { icon: Boxes, tone: "accent" },
  "/orders/budgets": { icon: IndianRupee, tone: "success" },
  "/orders/budget-approval": { icon: BadgeCheck, tone: "warning" },
};

/** The mark for an href, or `undefined` so the card keeps its own defaults. */
export function groupHubMark(href: string | null): HubMark | undefined {
  return href ? GROUP_HUB_ICONS[href] : undefined;
}
