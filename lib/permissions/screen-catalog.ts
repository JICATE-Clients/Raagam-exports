/**
 * THE SCREEN CATALOG — Module → Sub-module → Screen, for the permission tree
 * (Roles & Permissions, Permission Overrides) and for screen-level checks.
 *
 * DERIVED, NEVER HAND-LISTED (user 2026-09-30: "in future any module is added
 * it should fetch automatically"). It reads the registries that already drive
 * the sidebar, so a screen added to any of them is in the tree the same day:
 *
 *   - `NAV` (components/shell/nav.ts)          → the modules, their labels and
 *                                                 their permission `Module`;
 *   - `MODULE_GROUPS` (lib/nav/module-groups)  → sub-modules (groups) and their
 *                                                 screens, plus standalone links;
 *   - `SUBMODULES` / `mastersEntityLinks()`    → Master Data's sub-modules and
 *                                                 every entity screen;
 *   - `REPORTS` (lib/reports/catalog)          → each report, under its own module;
 *   - NAV's literal children                    → one sub-module for those modules.
 *
 * A SCREEN'S KEY IS ITS HREF. `screenOfPath()` maps any URL to its screen by the
 * longest href prefix, which is how a page load or a server action (it POSTs to
 * the page's own URL) is attributed to the screen it happened on.
 *
 * A PAGE THAT EXISTS IS A SCREEN. A `hidden` group (retired from the sidebar)
 * and an `unavailable` leaf (Planning, pending rebuild) still have pages that
 * open by URL, so they are IN the catalog — flagged, so the tree can say so —
 * or a role could not be kept out of them. Left out: `cardOnly` children
 * (their row lives in another group, which lists them — twice would give one
 * screen two toggles), `todo` leaves (no page yet) and `external` children
 * (another module's screen). Hubs — a module root, a group route — are card
 * pages, not screens: they fall back to the module grant.
 *
 * Client-safe and pure: the tree renders from it, the server resolves from it,
 * `npm run check:screen-catalog` holds it to the routes on disk.
 */

import { NAV } from "@/components/shell/nav";
import { MODULE_GROUPS } from "@/lib/nav/module-groups";
import { SUBMODULES } from "@/lib/masters/submodules";
import { mastersEntityLinks } from "@/lib/masters/masters-nav";
import { REPORTS, reportHref } from "@/lib/reports/catalog";
import { ACTIONS, type Action, type Module } from "@/lib/auth/types";

export type CatalogScreen = {
  /** The screen's href — the permission key. */
  key: string;
  label: string;
  /** The permission module its page and actions check. */
  module: Module;
  /** Off the sidebar but still reachable by URL: a retired group's screen, or a
   *  Planning screen pending rebuild. Shown, flagged, and enforced like any other. */
  note?: "hidden" | "unavailable";
};

export type CatalogSubmodule = {
  key: string;
  label: string;
  screens: CatalogScreen[];
  /** The whole group is off the sidebar (`hidden` in MODULE_GROUPS). */
  note?: "hidden";
};

export type CatalogModule = {
  /** The module's nav href. */
  key: string;
  label: string;
  module: Module;
  submodules: CatalogSubmodule[];
};

/**
 * Module roots that ARE a screen, not a hub of cards: the dashboard, the
 * analytics page, and the approvals inbox (its only child, Flows, sits
 * beneath it). Every other module root renders cards and falls back to the
 * module grant.
 */
const ROOT_SCREENS = new Set(["/", "/analytics", "/approvals"]);

/** Build the tree. Pure; cheap enough to call per render, memoised below. */
export function buildScreenCatalog(): CatalogModule[] {
  const out: CatalogModule[] = [];
  for (const item of NAV) {
    const submodules: CatalogSubmodule[] = [];
    const rootScreen = (): CatalogScreen => ({ key: item.href, label: item.label, module: item.module });

    const grouping = MODULE_GROUPS[item.href];
    if (grouping) {
      const loose: CatalogScreen[] = [];
      for (const e of grouping.entries) {
        if (e.kind === "link") {
          loose.push({
            key: e.href,
            label: e.label,
            module: grouping.module,
            ...(e.status === "unavailable" ? { note: "unavailable" as const } : {}),
          });
          continue;
        }
        const screens = e.children
          .filter((c) => !c.cardOnly && c.status !== "todo" && !c.external && c.href !== item.href)
          .map((c) => ({
            key: c.href,
            label: c.label,
            module: grouping.module,
            ...(e.hidden ? { note: "hidden" as const } : c.status === "unavailable" ? { note: "unavailable" as const } : {}),
          }));
        if (screens.length) {
          submodules.push({
            key: `${item.href}/${e.slug}`,
            label: e.label,
            screens,
            ...(e.hidden ? { note: "hidden" as const } : {}),
          });
        }
      }
      if (loose.length) submodules.push({ key: `${item.href}#general`, label: "General", screens: loose });
    } else if (item.href === "/masters") {
      for (const sub of SUBMODULES) {
        const screens = mastersEntityLinks(sub.slug).map((l) => ({ key: l.href, label: l.label, module: item.module }));
        if (screens.length) submodules.push({ key: `/masters/${sub.slug}`, label: sub.label, screens });
      }
    } else if (item.href === "/reports") {
      submodules.push({
        key: "/reports#all",
        label: "Reports",
        /* The MENU module's key (`reports`), not each report's own `module`.
           A screen's module decides which module a tick switches to screen
           mode — a report declared under `orders` would otherwise flip a role's
           whole Orders module into screen mode from a tick under Reports.
           A report page that gates on another module falls back to that
           module's grant (screenOfPath only narrows a module it belongs to). */
        screens: REPORTS.map((r) => ({ key: reportHref(r), label: r.label, module: item.module })),
      });
    } else {
      const screens: CatalogScreen[] = [];
      if (ROOT_SCREENS.has(item.href)) screens.push(rootScreen());
      for (const c of [...(item.children ?? []), ...(OFF_MENU_SCREENS[item.href] ?? [])]) {
        screens.push({ key: c.href, label: c.label, module: item.module });
      }
      if (screens.length === 0) screens.push(rootScreen());
      submodules.push({ key: `${item.href}#screens`, label: item.label, screens });
    }
    if (grouping && ROOT_SCREENS.has(item.href)) {
      submodules.unshift({ key: `${item.href}#root`, label: item.label, screens: [rootScreen()] });
    }
    if (submodules.length) out.push({ key: item.href, label: item.label, module: item.module, submodules });
  }
  return out;
}

/**
 * SCREENS THAT LEFT THE SIDEBAR BUT NOT THE APP (user 2026-10-09: Sample's
 * Opportunities & Costing, SQ Details, Pipeline & Seasonal and Catalogues &
 * Pricing came off the menu). Their routes still answer, so they stay screens
 * here: dropping them would make each one fall back to the module grant — a
 * role kept out of SQ Details by a screen tick could then open it by URL — and
 * would orphan any screen rows already stored for them. Appended after the
 * module's sidebar children, under the same sub-module.
 */
const OFF_MENU_SCREENS: Readonly<Record<string, readonly { href: string; label: string }[]>> = {
  "/sales": [
    { href: "/sales/opportunities-costing", label: "Opportunities & Costing" },
    { href: "/sales/sq-details", label: "SQ Details" },
    { href: "/sales/pipeline-orders", label: "Pipeline & Seasonal" },
    { href: "/sales/catalogues", label: "Catalogues & Pricing" },
  ],
};

/**
 * PAGES WITH NO REGISTRY ROW THAT BELONG TO A SCREEN — a sub-screen opened
 * from its parent, so it carries the parent's permission. Without this a role
 * kept out of the parent could still reach the child by URL (it would fall
 * back to the module grant). Each target must be a catalog screen and each
 * source a page on disk; `npm run check:screen-catalog` holds both.
 */
export const SCREEN_ALIASES: Readonly<Record<string, string>> = {
  // Opened from Internal Work Orders (iwo-screen.tsx) — its budget and BOMs.
  "/orders/iwo-budgets": "/orders/internal-work-orders",
  "/orders/iwo-fabric-bom": "/orders/internal-work-orders",
  "/orders/iwo-material-bom": "/orders/internal-work-orders",
  // Cards on the Opportunities & Costing hub page (its literal card list).
  "/sales/cost-sheets": "/sales/opportunities-costing",
  "/sales/quotes": "/sales/opportunities-costing",
  "/sales/quote-confirmations": "/sales/opportunities-costing",
  // The sample-tracking screen, off the Sample Entry row since the Samples &
  // Development hub retired into it (2026-10-06).
  "/sales/samples": "/sales/sample-entry",
};

let cached: CatalogModule[] | null = null;
/** The catalog, built once per process (the registries are compile-time data). */
export function screenCatalog(): CatalogModule[] {
  return (cached ??= buildScreenCatalog());
}

/** Every screen, flat. */
export function allScreens(catalog: CatalogModule[] = screenCatalog()): CatalogScreen[] {
  return catalog.flatMap((m) => m.submodules.flatMap((s) => s.screens));
}

/**
 * The screen a URL belongs to — longest href prefix across the whole catalog,
 * so `/purchase/indents/123/edit` is `/purchase/indents`. `/` matches only
 * itself (every path starts with it). Null for a hub or an unregistered route:
 * those fall back to the module grant.
 */
export function screenOfPath(pathname: string | null | undefined, catalog: CatalogModule[] = screenCatalog()): CatalogScreen | null {
  if (!pathname) return null;
  let path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  /* A sub-screen with no registry row takes its parent's key (SCREEN_ALIASES). */
  for (const [from, to] of Object.entries(SCREEN_ALIASES)) {
    if (path === from || path.startsWith(from + "/")) {
      path = to;
      break;
    }
  }
  let best: CatalogScreen | null = null;
  for (const s of allScreens(catalog)) {
    const hit = s.key === "/" ? path === "/" : path === s.key || path.startsWith(s.key + "/");
    if (hit && (!best || s.key.length > best.key.length)) best = s;
  }
  return best;
}

/**
 * The actions a screen offers in the tree — the ones the permission catalog
 * has for its module (Reports has only view / export), so the tree never shows
 * a toggle nothing enforces. Without a catalog, every action.
 */
export function actionsForModule(
  module: Module,
  catalogRows?: readonly { module: string; action: string }[],
): Action[] {
  if (!catalogRows) return [...ACTIONS];
  const have = new Set(catalogRows.filter((r) => r.module === module).map((r) => r.action));
  return ACTIONS.filter((a) => have.has(a));
}
