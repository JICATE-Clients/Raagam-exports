"use client";

import { useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAppUser } from "@/lib/auth/permission-context";
import { useOpenWorkspaceTab } from "@/lib/workspace-tabs";
import { cn } from "@/lib/utils";
import { activeModule, visibleModules } from "./navigation-config";
import { SidebarItem } from "./SidebarItem";

/**
 * LEVEL 1 — the icon rail. Collapsed (64px) by default, floats out to ~250px
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

  return (
    <div className="relative h-full w-16 shrink-0">
      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-border bg-surface",
          "transition-[width] duration-[220ms] ease-out",
          expanded ? "w-44 shadow-md" : "w-16",
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

        <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-1.5">
          {items.map((item) => {
            const Icon = item.icon;

            return (
              <SidebarItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={<Icon className="h-4 w-4 shrink-0" />}
                collapsed={!expanded}
                active={active?.href === item.href}
                onClick={(e) => {
                  e.preventDefault();
                  openTab({ href: item.href, title: item.label });
                }}
              />
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
