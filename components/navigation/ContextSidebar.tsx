"use client";

import type { MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { useOpenWorkspaceTab } from "@/lib/workspace-tabs";
import { useAppUser } from "@/lib/auth/permission-context";
import type { StoreNavLink } from "@/components/shell/sidebar-types";
import {
  activeChildFor,
  activeModule,
  isRouteActive,
  visibleModules,
  type SubNavItem,
} from "./navigation-config";
import { SidebarItem } from "./SidebarItem";
import { SidebarSection } from "./SidebarSection";

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

  const activeHref = activeChildFor(pathname, mod.href, children);

  function navigate(href: string, title: string) {
    return (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      openTab({ href, title });
    };
  }

  return (
    <aside className="flex h-full w-44 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h2 className="truncate text-sm font-semibold text-foreground">{mod.label}</h2>
      </div>

      <nav className="flex-1 space-y-0.5 p-1.5">
        <SidebarItem
          href={mod.href}
          label="Home"
          active={!activeHref && isRouteActive(pathname, mod.href)}
          onClick={navigate(mod.href, mod.label)}
        />

        <SidebarSection>
          {children.map((child) => {
            const childActive = child.href === activeHref;
            return (
              <div key={child.href}>
                <SidebarItem
                  href={child.href}
                  label={child.label}
                  active={childActive}
                  onClick={navigate(child.href, child.label)}
                />

                {/* THIRD SIDEBAR LEVEL — scoped to only the active sub-module,
                    so an inactive one (e.g. Order Execution) stays one row. */}
                {childActive && !!child.children?.length && (
                  <div className="mt-0.5 space-y-0.5 border-l border-border pl-2">
                    {child.children.map((grandchild) => (
                      <SidebarItem
                        key={grandchild.href}
                        href={grandchild.href}
                        label={grandchild.label}
                        indent={1}
                        active={isRouteActive(pathname, grandchild.href)}
                        onClick={navigate(grandchild.href, grandchild.label)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </SidebarSection>
      </nav>
    </aside>
  );
}
