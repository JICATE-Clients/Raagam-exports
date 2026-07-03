import {
  Plus,
  Upload,
  Download,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { NAV, SECTION_ACTIONS, type NavItem, type SubNavItem } from "./nav";

/**
 * Shared navigation-search logic. Both the mobile Peek Sheet (`mobile-nav.tsx`)
 * and the desktop command palette (`components/search/`) build their
 * module/section/action rows from here so the two stay in sync.
 */

/** A navigation/action hit rendered in a search list. */
export interface NavSearchRow {
  key: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  href: string;
  /** True when the row triggers a create/import/export action (not a page). */
  isAction?: boolean;
}

/** Icon for an action label (create / import / export / recalc). */
export function actionIcon(label: string): LucideIcon {
  if (/^(import|bulk)/i.test(label)) return Upload;
  if (/^(export|generate)/i.test(label)) return Download;
  if (/^recalc/i.test(label)) return RefreshCw;
  return Plus;
}

/** Route the primary/quick create actions point at (page reads `?new=1`). */
export function createHref(ownerHref: string, action: string) {
  return `${ownerHref}?new=1&a=${encodeURIComponent(action)}`;
}

/** Resolve a module's child sections (default: its static `children`). */
export type ChildrenResolver = (
  moduleHref: string,
  children?: SubNavItem[],
) => SubNavItem[];

const defaultChildren: ChildrenResolver = (_href, children) => children ?? [];

/**
 * Search modules → sections → quick-actions for `query`, returning flat rows.
 * `modules` should already be permission-filtered by the caller. `childrenFor`
 * lets callers inject dynamic sections (e.g. mobile-nav surfaces live store
 * records under `/stores`).
 */
export function searchNav(
  query: string,
  modules: NavItem[] = NAV,
  childrenFor: ChildrenResolver = defaultChildren,
): NavSearchRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return modules.flatMap((m) => {
    const rows: NavSearchRow[] = [];

    if (m.label.toLowerCase().includes(q))
      rows.push({
        key: "m:" + m.href,
        icon: m.icon,
        title: m.label,
        sub: "Module",
        href: m.href,
      });

    for (const c of childrenFor(m.href, m.children)) {
      if (c.label.toLowerCase().includes(q))
        rows.push({
          key: "s:" + c.href,
          icon: m.icon,
          title: c.label,
          sub: m.label + " · section",
          href: c.href,
        });
      for (const a of SECTION_ACTIONS[c.href] ?? []) {
        if (a.toLowerCase().includes(q))
          rows.push({
            key: "a:" + c.href + a,
            icon: actionIcon(a),
            title: a,
            sub: m.label + " · " + c.label,
            href: createHref(c.href, a),
            isAction: true,
          });
      }
    }

    for (const a of SECTION_ACTIONS[m.href] ?? []) {
      if (a.toLowerCase().includes(q))
        rows.push({
          key: "a:" + m.href + a,
          icon: actionIcon(a),
          title: a,
          sub: m.label,
          href: createHref(m.href, a),
          isAction: true,
        });
    }

    return rows;
  });
}
