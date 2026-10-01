import {
  Plus,
  Upload,
  Download,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { NAV, type NavItem, type SubNavItem } from "./nav";
import { allowedSectionActions } from "@/lib/nav/section-action-access";
import { navEntry } from "@/components/navigation/navigation-config";
import type { AppUser } from "@/lib/auth/types";
import { moduleLeafItems } from "@/lib/nav/module-groups";

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
  /** Whose quick actions to offer — only those this login may perform. */
  user: AppUser | null = null,
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

    // Sidebar rows PLUS the screens inside each group. A grouped module's
    // `children` are sub-modules, so searching only those would have made every
    // leaf ("Fabric BOM") and every leaf-keyed quick action ("New Worker")
    // unfindable — the sidebar got shorter, search must not get smaller.
    // Deduped by href: a standalone row is a sidebar child and nothing else,
    // and the store links injected by `childrenFor` are not in the registry.
    const sections = childrenFor(m.href, m.children);
    const seen = new Set(sections.map((c) => c.href));
    const searchable: { href: string; label: string; sub: string }[] = [
      ...sections.map((c) => ({
        href: c.href,
        label: c.label,
        sub: m.label + " · section",
      })),
      ...moduleLeafItems(m.href)
        .filter((l) => !seen.has(l.href))
        .map((l) => ({
          href: l.href,
          label: l.label,
          sub: m.label + " · " + l.groupLabel,
        })),
    ];

    for (const raw of searchable) {
      // A regular staff member's "Staff" is "My Profile" → their own record.
      const c = navEntry(user, raw);
      if (c.label.toLowerCase().includes(q))
        rows.push({
          key: "s:" + c.href,
          icon: m.icon,
          title: c.label,
          sub: c.sub,
          href: c.href,
        });
      for (const a of allowedSectionActions(user, raw.href)) {
        if (a.toLowerCase().includes(q))
          rows.push({
            key: "a:" + c.href + a,
            icon: actionIcon(a),
            title: a,
            sub: m.label + " · " + c.label,
            href: createHref(raw.href, a),
            isAction: true,
          });
      }
    }

    for (const a of allowedSectionActions(user, m.href)) {
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
