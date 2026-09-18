"use client";

import { useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAppUser } from "@/lib/auth/permission-context";
import { useOpenWorkspaceTab } from "@/lib/workspace-tabs";
import { cn } from "@/lib/utils";
import { activeModule, visibleModules, type NavItem } from "./navigation-config";
import { SidebarItem } from "./SidebarItem";

/**
 * Captions for the open flyout (client 2026-09-17, sidebar option A). Keyed by
 * module href; the first, uncaptioned band holds the overview screens. A
 * module missing from this table lands in the last band rather than
 * vanishing, so a new NAV entry is still reachable before anyone files it.
 */
const RAIL_BANDS: { label?: string; hrefs: string[] }[] = [
  { hrefs: ["/", "/analytics", "/reports", "/approvals"] },
  { label: "Commercial", hrefs: ["/sales", "/orders"] },
  { label: "Operations", hrefs: ["/planning", "/purchase", "/stores", "/production", "/logistics"] },
  { label: "People & Accounts", hrefs: ["/hr", "/finance"] },
  { label: "System", hrefs: ["/masters", "/integration", "/admin"] },
];

function toBands(items: NavItem[]) {
  const placed = new Set<string>();
  const bands = RAIL_BANDS.map((b) => {
    const rows = b.hrefs
      .map((h) => items.find((i) => i.href === h))
      .filter((i): i is NavItem => !!i);
    rows.forEach((r) => placed.add(r.href));
    return { label: b.label, rows };
  });
  const rest = items.filter((i) => !placed.has(i.href));
  bands[bands.length - 1].rows.push(...rest);
  // A permission-trimmed band with nothing left would draw a lone caption.
  return bands.filter((b) => b.rows.length > 0);
}

/**
 * LEVEL 1 — the icon rail. Collapsed (64px) by default, floats out to 208px
 * on hover without moving anything else on screen: the rail's real layout
 * width never changes, only a `fixed` overlay grows on top of it.
 *
 * Clicking a module always navigates there (same as the previous single
 * sidebar) — `ContextSidebar` picks up the new active module from the route,
 * so nothing here needs to "remember" a selection of its own.
 */
export function GlobalSidebar() {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenWorkspaceTab();
  const [expanded, setExpanded] = useState(false);

  const items = visibleModules(user);
  const active = activeModule(pathname, items);
  const bands = toBands(items);

  return (
    <div className="relative h-full w-16 shrink-0">
      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-border bg-surface",
          "transition-[width,border-radius,box-shadow] duration-[220ms] ease-out",
          // Open, it FLOATS: rounded trailing edge and a real lift, so it
          // reads as a panel over the page rather than a wider column.
          expanded ? "w-52 rounded-r-2xl shadow-elev-hi" : "w-16",
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-center border-b border-border px-3">
          <Image
            src="/brand/raagam-wordmark.png"
            alt="Raagam Exports"
            width={431}
            height={184}
            priority
            className={cn(
              "transition-all duration-[220ms] ease-out",
              expanded ? "h-10 w-auto max-w-full" : "h-auto w-10",
            )}
          />
        </div>

        <nav className="scrollbar-slim flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-1.5">
          {bands.map((band, bi) => (
            <div key={band.label ?? bi} className="space-y-0.5">
              {/* One fixed `h-5` either way: open it is the caption and its
                  hairline, closed it is a short divider. Same height in both
                  states, so no icon moves when the panel opens (09-16). */}
              {band.label && (
                <div className="flex h-5 items-center gap-2 px-2" aria-hidden={!expanded}>
                  {expanded ? (
                    <>
                      <span className="ty-sidebar-group shrink-0 whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {band.label}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </>
                  ) : (
                    <span className="mx-auto h-px w-6 bg-border" />
                  )}
                </div>
              )}
              {band.rows.map((item) => {
                const Icon = item.icon;
                const isActive = active?.href === item.href;

                return (
                  <div key={item.href} className="relative">
                    {/* Closed rail: a brand-green tab on the window edge
                        (the nav's `p-1.5` is what `-left-1.5` reaches past).
                        Brand on a CONTROL mark, never a surface. */}
                    {isActive && !expanded && (
                      <span
                        aria-hidden
                        className="absolute -left-1.5 top-2 h-6 w-1 rounded-r bg-brand-green"
                      />
                    )}
                    <SidebarItem
                      href={item.href}
                      label={item.label}
                      icon={<Icon className="h-4 w-4 shrink-0" />}
                      collapsed={!expanded}
                      active={isActive}
                      trailing={
                        isActive ? (
                          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" />
                        ) : undefined
                      }
                      // BREATHING ROOM IN THE OPEN FLYOUT (client 2026-09-16: "in
                      // opening state the sidebar menu looks squeezed"). `h-10` is
                      // the collapsed icon's own height, so the rows no longer
                      // shrink 40px -> 32px as the panel opens and the icons stay
                      // put under the pointer; `w-full` makes the active pill a
                      // whole row instead of a tag hugging its label.
                      className={cn(
                        "rounded-xl",
                        expanded && "h-10 w-full gap-3",
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        openTab({ href: item.href, title: item.label });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}
