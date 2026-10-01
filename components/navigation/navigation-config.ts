/**
 * Glue between the two-level nav components and the app's existing routing
 * config. Deliberately holds no route data of its own — `NAV`
 * (components/shell/nav.ts) and `MODULE_GROUPS` (lib/nav/module-groups.ts)
 * stay the single source of truth for what routes exist. A new module or
 * screen still only ever needs to be declared in ONE of those two places.
 */
import type { MouseEvent } from "react";
import { NAV, type NavItem, type SubNavItem } from "@/components/shell/nav";
import { owningNavHref } from "@/lib/nav/module-groups";
import { hasPermission, type AppUser } from "@/lib/auth/types";
import { screenOfPath } from "@/lib/permissions/screen-catalog";

export { NAV };
export type { NavItem, SubNavItem };

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** A plain left-click, no modifier — the only kind worth intercepting.
 *  Ctrl/Cmd/Shift/middle-click all mean "open in a new browser tab" and
 *  must reach the native anchor untouched. */
export function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** Href of the deepest child whose route matches the current path (longest prefix wins). */
export function activeChildHref(
  pathname: string,
  children: { href: string }[],
): string | undefined {
  return children
    .filter((c) => isRouteActive(pathname, c.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** The top-level NAV item that owns the current route, if any. */
export function activeModule(pathname: string, items: NavItem[]): NavItem | undefined {
  return items
    .filter((i) => isRouteActive(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * Whether the module menu (ContextSidebar) draws anything for this module —
 * the same test it applies before rendering: a module with no sub-navigation
 * gets no menu, and Stores counts its live store links as rows. The sidebar
 * shell reads it to size the brand row and the rail's flyout.
 */
export function hasModuleMenu(mod: NavItem | undefined, storeCount: number): boolean {
  if (!mod) return false;
  return (mod.children?.length ?? 0) > 0 || (mod.href === "/stores" && storeCount > 0);
}

/** The child row that should read as active for a module — group-aware.
 *  A grouped module (Orders, Purchase, …) answers from its registry, because
 *  its leaf routes are NOT paths beneath the group they belong to. Ungrouped
 *  modules and injected rows (e.g. Stores' live store links) fall back to a
 *  plain prefix scan. */
export function activeChildFor(
  pathname: string,
  moduleHref: string,
  children: SubNavItem[],
): string | undefined {
  if (children.length === 0) return undefined;
  return owningNavHref(moduleHref, pathname) ?? activeChildHref(pathname, children);
}

type NavUser = Pick<AppUser, "isSuperAdmin" | "permissions" | "moduleMode" | "screenGrants"> | null;

/** May the user open this href — its screen's View (0658)? A hub / group row
 *  is not a screen and answers true; its children decide whether it shows. */
export function screenVisible(user: NavUser, href: string): boolean {
  const screen = screenOfPath(href);
  if (!screen) return true;
  return hasPermission(user, screen.module, "view", screen);
}

/** A module's children with every screen the user may not view taken out,
 *  and a group row dropped once nothing under it is left. */
function visibleChildren(user: NavUser, children: SubNavItem[] | undefined): SubNavItem[] | undefined {
  if (!children) return children;
  const out: SubNavItem[] = [];
  for (const c of children) {
    if (c.children?.length) {
      const rows = c.children.filter((g) => screenVisible(user, g.href));
      if (rows.length) out.push({ ...c, children: rows });
    } else if (screenVisible(user, c.href)) {
      out.push(c);
    }
  }
  return out;
}

/**
 * NAV items the current user may see, permission-filtered — the module by its
 * View, and (0658) each child screen by ITS View, so a role or a person's
 * email access that grants only some screens sees only those rows. Every nav
 * surface reads this one filter: both sidebars, the mobile nav, the workspace
 * tab bar.
 */
export function visibleModules(user: NavUser): NavItem[] {
  return NAV.filter((i) => hasPermission(user, i.module, "view")).map((i) =>
    i.children ? { ...i, children: visibleChildren(user, i.children) } : i,
  );
}
