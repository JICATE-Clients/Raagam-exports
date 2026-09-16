"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { useOpenWorkspaceTab } from "@/lib/workspace-tabs";
import { useAppUser } from "@/lib/auth/permission-context";
import type { StoreNavLink } from "@/components/shell/sidebar-types";
import { SECTION_ACTIONS } from "@/components/shell/nav";
import { createHref } from "@/components/shell/nav-search";
import { useRecent } from "@/lib/use-recent";
import { buttonClasses } from "@/components/ui/button";
import {
  activeChildHref,
  activeModule,
  visibleModules,
  type SubNavItem,
} from "./navigation-config";
import { SidebarItem } from "./SidebarItem";
import { SidebarSection } from "./SidebarSection";

/** A run of rows under one caption — a registry group, or the loose rows
 *  between groups (no caption). */
interface SidebarBlock {
  key: string;
  label?: string;
  rows: { href: string; label: string }[];
}

/**
 * Flatten a module's children into captioned blocks: a group becomes its
 * caption plus its screens, and consecutive standalone rows share one
 * uncaptioned block. Every screen is therefore one click away and there is no
 * expand/collapse state to fall out of step with the route.
 */
function toBlocks(children: SubNavItem[]): SidebarBlock[] {
  const blocks: SidebarBlock[] = [];
  for (const c of children) {
    if (c.children?.length) {
      blocks.push({ key: c.href, label: c.label, rows: c.children });
    } else {
      const last = blocks[blocks.length - 1];
      if (last && !last.label) last.rows.push({ href: c.href, label: c.label });
      else blocks.push({ key: c.href, rows: [{ href: c.href, label: c.label }] });
    }
  }
  return blocks;
}

/** How many recently opened RECORDS to offer — a short list, not a history. */
const RECENT_LIMIT = 3;

/**
 * LEVEL 2 — the contextual sidebar for whichever module the current route is
 * in. Unlike the rail, this one is NOT hover-driven: it is derived straight
 * from `pathname`, so refresh, back/forward and a plain click on the rail all
 * land it on the right module for free (requirements 5, 6, 9, 10 — there is
 * no separate "selected module" state to fall out of sync with the URL).
 *
 * Renders nothing for a module with no sub-navigation (Dashboard, Analytics)
 * so no empty 250px column is reserved for it.
 */
export function ContextSidebar({ stores = [] }: { stores?: StoreNavLink[] }) {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenWorkspaceTab();
  // ABOVE THE EARLY RETURNS — see "Hooks above every early return" in AGENTS.md.
  // Re-read on every route change so a record opened a moment ago shows up.
  const recent = useRecent(pathname);

  const items = visibleModules(user);
  const mod = activeModule(pathname, items);
  if (!mod) return null;

  // Live store records are listed directly under the Stores group, ahead of
  // its fixed operation sub-modules (Opening Stock, Requisitions, …) — same
  // injection the single-column sidebar did.
  const storeLinks: SubNavItem[] = stores.map((s) => ({
    href: `/stores/${s.id}`,
    label: s.name,
  }));
  const children: SubNavItem[] =
    mod.href === "/stores" ? [...storeLinks, ...(mod.children ?? [])] : (mod.children ?? []);

  if (children.length === 0) return null;

  /*
   * ALL GROUPS OPEN, ONE HIGHLIGHT (client 2026-09-16, option C of the sidebar
   * mock-ups). A group is a caption, never a row, so the solid bar
   * lands on exactly one thing — the screen the operator is on. It used to
   * paint the group AND its screen: two bars for one location.
   */
  const blocks = toBlocks(children);
  const leaves = blocks.flatMap((b) => b.rows);
  const activeHref = activeChildHref(pathname, leaves);

  // The create action of the screen in view — "New Garment Order" on Order
  // Entry. Only a "New …" action: Import/Export are list operations, not the
  // one thing this button promises. No action, no button.
  const newAction = activeHref
    ? SECTION_ACTIONS[activeHref]?.find((a) => /^new\b/i.test(a))
    : undefined;

  // Records only (an order, a PO) — a screen is already listed above, so
  // repeating it here would be the menu twice.
  const leafHrefs = new Set(leaves.map((l) => l.href));
  const recentHere = recent
    .filter(
      (r) =>
        r.href.startsWith(mod.href + "/") && !leafHrefs.has(r.href) && r.href !== pathname,
    )
    .slice(0, RECENT_LIMIT);

  function navigate(href: string, title: string) {
    return (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      openTab({ href, title });
    };
  }

  return (
    <aside className="scrollbar-slim flex h-full w-52 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h2 className="ty-subsection truncate text-sm font-semibold text-foreground">{mod.label}</h2>
      </div>

      {newAction && activeHref && (
        <div className="px-2 pt-2">
          <Link
            href={createHref(activeHref, newAction)}
            className={buttonClasses({ size: "sm", className: "w-full" })}
          >
            <Plus />
            {newAction}
          </Link>
        </div>
      )}

      {/* THE "HOME" ROW IS HIDDEN (operator, 2026-09-15) — it only ever
          reopened the module's own root/hub page, and that page's card grid
          was hidden the same day (`group-hub.tsx`) because it repeated this
          exact sidebar listing back at the operator. The module icon in the
          level-1 rail still reaches the same route. */}
      <nav className="flex-1 space-y-3 p-2">
        {blocks.map((block) => (
          <SidebarSection key={block.key} label={block.label}>
            {/* TEXT ONLY (client 2026-09-16: "it looks much icons") — the
                level-1 rail beside this column is already a column of icons,
                so a second one read as clutter. The captions and the single
                highlight carry the structure. */}
            {block.rows.map((row) => (
              <SidebarItem
                key={row.href}
                href={row.href}
                label={row.label}
                active={row.href === activeHref}
                className="h-9 w-full"
                onClick={navigate(row.href, row.label)}
              />
            ))}
          </SidebarSection>
        ))}
      </nav>

      {recentHere.length > 0 && (
        <div className="shrink-0 border-t border-border p-2">
          <SidebarSection label="Recently opened">
            {recentHere.map((r) => (
              <SidebarItem
                key={r.href}
                href={r.href}
                label={r.title}
                className="h-8 w-full tabular-nums"
                onClick={navigate(r.href, r.title)}
              />
            ))}
          </SidebarSection>
        </div>
      )}
    </aside>
  );
}
