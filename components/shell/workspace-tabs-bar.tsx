"use client";

/**
 * The open-tabs strip — a compact browser/IDE-style workspace bar. This is a
 * visual replacement only: every behaviour still comes straight from
 * `lib/workspace-tabs.ts` (open, dedupe-by-href, switch, close, close
 * others/all) and switching or closing still navigates via the router,
 * exactly as before. See that file for what the store does and does not do.
 *
 * WHY HOME IS NOT ONE OF `tabs`. `useEnsureWorkspaceTab` below still fires
 * for every route including "/", so the store always ends up holding a Home
 * entry once the operator has visited it — that part is untouched. This bar
 * just never RENDERS it from the `tabs` list: Home is drawn once, fixed,
 * first, keyed off `pathname === "/"` directly. That is what makes it
 * un-closable without adding a "some tabs can't be closed" branch to the
 * store — the hidden entry closes like any other on "Close all" and simply
 * gets recreated the next time Home is visited.
 *
 * WHY THE OLD "SIBLING SCREENS" TRACK IS GONE. The previous bar also listed
 * the active tab's OTHER sub-module screens in a second pill row — the same
 * list `ContextSidebar` (components/navigation/) now renders as the level-2
 * sidebar. Keeping both was exactly the duplication the two-level nav was
 * built to avoid, so this bar shows open tabs and nothing the sidebar
 * already owns.
 *
 * WHY A HUB PAGE NEVER BECOMES A TAB. Drilling Orders → Order Management →
 * Order Entry crosses three routes: the module root, the group's own hub
 * page, and the real screen. Only the last one is something the operator
 * "opened" in any sense worth a tab — the first two are the sidebar's own
 * hierarchy, rendered as a page only because a click has to land somewhere.
 * `isHubRoute` (lib/nav/module-groups.ts) is the same registry ContextSidebar
 * reads, so a route only counts as a hub here when it provably renders a
 * card index there too — never a guess. `useEnsureWorkspaceTab` is told to
 * `skip` for one, so passing through it leaves the tab strip untouched; the
 * tab that ends up open is whichever real screen the operator lands on.
 */

import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MoreHorizontal, X, type LucideIcon } from "lucide-react";
import { useEnsureWorkspaceTab, useOpenWorkspaceTab, useWorkspaceTabs } from "@/lib/workspace-tabs";
import { NAV } from "@/components/shell/nav";
import { isHubRoute } from "@/lib/nav/module-groups";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { isPlainLeftClick } from "@/components/navigation/navigation-config";
import { cn } from "@/lib/utils";

/** Last-resort title for a route NAV doesn't know about (a dynamic `[id]`
 *  detail page, say) — never the first choice, because a slug reads nothing
 *  like the sidebar's actual label ("Order Management" vs "Setup"). */
function titleFromSlug(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean).pop() ?? "Home";
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The label Sidebar would show for this exact route, if NAV knows it — same
 *  registry, so the tab bar can never disagree with the sidebar about what a
 *  screen is called. Walks all three sidebar levels (module → group → leaf
 *  screen), because the tab bar only ever shows the deepest one: `/orders`
 *  and `/orders/setup` are hubs `isHubRoute` skips outright, but
 *  `/orders/garment-orders` is a group's grandchild and needs that third
 *  level to read "Order Entry" instead of falling through to the slug. */
function titleForPath(pathname: string): string {
  for (const item of NAV) {
    if (item.href === pathname) return item.label;
    for (const child of item.children ?? []) {
      if (child.href === pathname) return child.label;
      for (const grandchild of child.children ?? []) {
        if (grandchild.href === pathname) return grandchild.label;
      }
    }
  }
  return titleFromSlug(pathname);
}

/** Same prefix-match `Sidebar` uses for "is this route inside this module". */
function isUnderModule(pathname: string, moduleHref: string): boolean {
  if (moduleHref === "/") return pathname === "/";
  return pathname === moduleHref || pathname.startsWith(moduleHref + "/");
}

/** The icon NAV already draws for this route's module, in the sidebar — so a
 *  tab's icon never says something the sidebar doesn't. */
function iconForPath(pathname: string, modules: { href: string; icon: LucideIcon }[]) {
  return modules.find((m) => isUnderModule(pathname, m.href))?.icon;
}

export function WorkspaceTabsBar() {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenWorkspaceTab();

  // Keep the CURRENT route present as a tab — but only when it's a real
  // destination. A hub page (a module root or a group's own card index)
  // never registers one, so drilling down through the hierarchy on the way
  // to a screen leaves no trail of tabs behind it; the sidebar already shows
  // that path. `useEnsureWorkspaceTab` never overwrites a title a caller
  // already set (the sidebar's click, or a screen's own
  // useRegisterWorkspaceTab) — only fills one in when creating the tab fresh.
  useEnsureWorkspaceTab({
    href: pathname,
    title: titleForPath(pathname),
    skip: pathname === "/" || isHubRoute(pathname),
  });

  const { tabs, activate, close, closeOthers, closeAll } = useWorkspaceTabs();

  const modules = NAV.filter((i) => hasPermission(user, i.module, "view"));
  const showHome = hasPermission(user, "dashboard", "view");
  const isHomeActive = pathname === "/";
  // Home is drawn once, fixed, ahead of the list — see the file header.
  const openTabs = tabs.filter((t) => t.href !== "/");
  // The store's own `activeId` can lag one route behind while the operator
  // is standing on a hub page (nothing registers a tab for it, on purpose —
  // see above), so which tab reads as "current" is resolved from the route
  // actually on screen, not from that pointer.
  const currentTab = openTabs.find((t) => t.href === pathname);

  const overflowItems: DropdownItem[] = [
    ...openTabs.map(
      (t): DropdownItem => ({
        label: t.title,
        icon: iconForPath(t.href, modules),
        onClick: () => activate(t.id),
        section: "Open screens",
      }),
    ),
    {
      label: "Close current",
      onClick: () => currentTab && close(currentTab.id),
      disabled: !currentTab,
      section: "Actions",
    },
    {
      label: "Close others",
      onClick: () => currentTab && closeOthers(currentTab.id),
      disabled: !currentTab || openTabs.length < 2,
      section: "Actions",
    },
    {
      label: "Close all",
      onClick: () => closeAll(),
      disabled: openTabs.length === 0,
      danger: true,
      section: "Actions",
    },
  ];

  return (
    // Went `bg-primary-soft` (4% tint, dull) → `bg-primary/10` (tint,
    // shipped) → tried `bg-brand-green/10` (reverted, "not good fit") →
    // SOLID `bg-primary` (client 2026-09-08, screenshot 2807: liked the
    // dashboard "New order" button's colour, asked for the whole bar to
    // match it, not just a tint). Solid needs its text inverted to white —
    // same trade `raagam-brand-colours` records for the footer band trying
    // this once before, except THERE it was rejected and HERE it's what was
    // asked for. `border-b border-border` dropped: a neutral grey edge
    // doesn't read against a saturated fill, same as the original gradient
    // bar never carried one either.
    <div className="flex h-9 flex-none items-center gap-1.5 bg-primary px-2">
      {showHome && (
        <button
          type="button"
          onClick={(e) => {
            if (!isPlainLeftClick(e)) return;
            openTab({ href: "/", title: "Home" });
          }}
          className={cn(
            "flex h-8 flex-none items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors duration-150",
            isHomeActive
              ? "bg-surface font-bold text-foreground shadow-sm"
              : "font-medium text-white/90 hover:bg-white/10",
          )}
        >
          <LayoutDashboard className={cn("h-3.5 w-3.5 flex-none", isHomeActive && "text-primary")} />
          Home
        </button>
      )}

      {openTabs.length > 0 && <span aria-hidden className="h-5 w-px flex-none bg-white/30" />}

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {openTabs.map((tab) => {
          const active = tab.href === pathname;
          const Icon = iconForPath(tab.href, modules);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => activate(tab.id)}
              className={cn(
                "group flex h-8 min-w-[130px] flex-none items-center gap-2 whitespace-nowrap rounded-md pl-3 pr-1.5 text-[13px] transition-colors duration-150",
                active
                  ? "bg-surface font-bold text-foreground shadow-sm"
                  : "font-medium text-white/90 hover:bg-white/10",
              )}
            >
              {Icon && <Icon className={cn("h-3.5 w-3.5 flex-none", active && "text-primary")} />}
              <span className="max-w-[160px] flex-1 truncate text-left">{tab.title}</span>
              {tab.dirty && (
                <span
                  aria-label="Unsaved changes"
                  className="h-1.5 w-1.5 flex-none rounded-full bg-warning"
                />
              )}
              <span
                role="button"
                aria-label={`Close ${tab.title}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.id);
                }}
                className={cn(
                  "flex h-5 w-5 flex-none items-center justify-center rounded-full opacity-0 transition-opacity duration-150 hover:bg-foreground/10 group-hover:opacity-100 group-focus-visible:opacity-100",
                  active && "opacity-60",
                )}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </button>
          );
        })}
      </div>

      {openTabs.length > 0 && (
        <DropdownMenu
          items={overflowItems}
          label="More open screens"
          trigger={<MoreHorizontal className="h-3.5 w-3.5" />}
          // Now that the whole BAR is solid `bg-primary` (below), a same-fill
          // button here would disappear into it — light overlay instead, so
          // it still reads as a control against the saturated background.
          triggerClassName="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white transition-colors duration-150 hover:bg-white/25"
          align="right"
        />
      )}
    </div>
  );
}
