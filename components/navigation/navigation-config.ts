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

/** NAV items the current user may see, permission-filtered. */
export function visibleModules(
  user: Pick<AppUser, "isSuperAdmin" | "permissions"> | null,
): NavItem[] {
  return NAV.filter((i) => hasPermission(user, i.module, "view"));
}
