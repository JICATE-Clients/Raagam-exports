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

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  MoreHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
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

/**
 * NOTEPAD-STYLE TABS (operator, 2026-09-17, a Windows Notepad screenshot:
 * "intha mari nav bar la venum but antha . mattum vendam").
 *
 * A tab is a piece of the page showing through the bar, not a pill floating
 * on it: every tab sits on the bar's bottom edge (`self-end`), rounded on
 * top only, and the ACTIVE one takes the page's own surface so it reads as
 * joined to the screen beneath. Inactive tabs are flat text on the bar,
 * separated by a short hairline, hidden beside the active tab, where the
 * tab's own edge already separates them, exactly as Notepad draws it.
 *
 * "ANTHA . MATTUM VENDAM": the unsaved dot is gone. Notepad marks a dirty
 * tab with it; this bar did the same off `tab.dirty`. The store still tracks
 * the flag (the reload guard reads dirtiness on its own, not from here), so
 * nothing but the mark is removed.
 */
const TAB =
  "ty-tab group relative flex h-8 flex-none items-center gap-2 self-end whitespace-nowrap rounded-t-md text-[13px] transition-colors duration-150";
const TAB_ACTIVE = "bg-surface font-bold text-foreground";
const TAB_IDLE = "font-medium text-white/90 hover:bg-white/10";
/** The hairline on a tab's right edge. */
const TAB_DIVIDER =
  "after:absolute after:right-0 after:top-1/2 after:h-4 after:w-px after:-translate-y-1/2 after:bg-white/30";
/** How far one scroll-arrow press moves the strip, roughly one tab. */
const SCROLL_STEP = 180;
const ARROW =
  "flex h-7 w-6 flex-none items-center justify-center rounded text-white transition-colors hover:bg-white/15 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";

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
  /**
   * THE MODULE'S OWN HOME CHIP IS HIDDEN (operator, 2026-09-15). It opened the
   * module's own root/hub page (client 2026-09-10's reasoning below is kept
   * for history), and that page's card grid was hidden the same day
   * (`group-hub.tsx`) because it repeated the sidebar's own sub-module
   * listing back at the operator. With the hub page's cards gone there is
   * nothing left for this chip to usefully open, so it is removed alongside
   * the sidebar's own "Home" row (`ContextSidebar.tsx`) rather than left
   * pointing at an empty page.
   *
   * ORIGINAL REASONING, client 2026-09-10: "here the home is routing for main
   * home but there is home in hr module also right, so in the multi bar this
   * hr home also should be shown" — standing on /hr/staff, "Home" goes to the
   * dashboard, and nothing in this bar went one level up to HR's own card
   * index; the sidebar's module row did it, but the bar is what the operator
   * sees while a page-mounted editor covers the sidebar. Restoring this is
   * "un-comment", not "re-derive" — `activeModule` / `isModuleHomeActive` are
   * untouched below.
   *
  const activeModule = modules.find(
    (m) => m.href !== "/" && isUnderModule(pathname, m.href),
  );
  const isModuleHomeActive = !!activeModule && pathname === activeModule.href;
   */
  // Home is drawn once, fixed, ahead of the list — see the file header.
  const openTabs = tabs.filter((t) => t.href !== "/");
  // The store's own `activeId` can lag one route behind while the operator
  // is standing on a hub page (nothing registers a tab for it, on purpose —
  // see above), so which tab reads as "current" is resolved from the route
  // actually on screen, not from that pointer.
  const currentTab = openTabs.find((t) => t.href === pathname);

  /**
   * ARROWS INSTEAD OF A SCROLLBAR, Notepad's answer to more tabs than fit.
   * Each arrow is live only while there is somewhere to go in its direction,
   * measured off the strip on scroll and on resize.
   */
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);
  // A new or closed tab changes the strip's content without resizing the
  // strip itself; and the tab on screen is scrolled into view, so navigating
  // to one that sits past the edge never leaves it hidden.
  useEffect(() => {
    measure();
    stripRef.current
      ?.querySelector<HTMLElement>('[data-tab-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [measure, openTabs.length, pathname]);
  const scrollStrip = (dx: number) =>
    stripRef.current?.scrollBy({ left: dx, behavior: "smooth" });
  const activeIndex = openTabs.findIndex((t) => t.href === pathname);

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
    // `ty-chrome`: a gradient colour option (lib/appearance.ts) paints this
    // bar; every solid option leaves it `bg-primary`.
    <div className="ty-chrome flex h-9 flex-none items-center gap-1 bg-primary px-2">
      {showHome && (
        <button
          type="button"
          onClick={(e) => {
            if (!isPlainLeftClick(e)) return;
            openTab({ href: "/", title: "Home" });
          }}
          className={cn(TAB, "gap-1.5 px-3", isHomeActive ? TAB_ACTIVE : TAB_IDLE)}
        >
          <LayoutDashboard className={cn("h-3.5 w-3.5 flex-none", isHomeActive && "text-primary")} />
          Home
        </button>
      )}

      {/* HIDDEN (operator, 2026-09-15) — see the comment above `activeModule`.
      {activeModule && (
        <button
          type="button"
          onClick={(e) => {
            if (!isPlainLeftClick(e)) return;
            // The same call the sidebar's module row makes. `openTab` sees a hub
            // href and only NAVIGATES — see its own note — so this cannot leave
            // a stray "HR & Payroll" tab behind.
            openTab({ href: activeModule.href, title: activeModule.label });
          }}
          className={cn(
            "ty-tab flex h-8 flex-none items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors duration-150",
            isModuleHomeActive
              ? "bg-surface font-bold text-foreground shadow-sm"
              : "font-medium text-white/90 hover:bg-white/10",
          )}
        >
          // The module's OWN nav icon, so the chip and the sidebar row the
          // operator would otherwise click carry the same mark.
          <activeModule.icon
            className={cn("h-3.5 w-3.5 flex-none", isModuleHomeActive && "text-primary")}
          />
          {activeModule.label}
        </button>
      )}
      */}

      {openTabs.length > 0 && <span aria-hidden className="h-5 w-px flex-none bg-white/30" />}

      {/* Scroll left. Chrome, not a field: off the Tab path like every
          control here. */}
      {openTabs.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scroll tabs left"
          disabled={!canLeft}
          onClick={() => scrollStrip(-SCROLL_STEP)}
          className={ARROW}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {/* THE STRIP. `h-full` so each tab can sit on the bar's bottom edge;
          no scrollbar, because the arrows either side are the way along it. */}
      <div
        ref={stripRef}
        className="scrollbar-none flex h-full min-w-0 flex-1 items-end overflow-x-auto"
      >
        {openTabs.map((tab, i) => {
          const active = i === activeIndex;
          const Icon = iconForPath(tab.href, modules);
          /* No hairline on the active tab, nor on the one just before it:
             the active tab's own edge is the separator there. */
          const divider = !active && i + 1 !== activeIndex && i < openTabs.length - 1;
          return (
            <button
              key={tab.id}
              type="button"
              data-tab-active={active}
              onClick={() => activate(tab.id)}
              className={cn(
                TAB,
                "min-w-[130px] pl-3 pr-1.5",
                active ? TAB_ACTIVE : TAB_IDLE,
                divider && TAB_DIVIDER,
              )}
            >
              {Icon && <Icon className={cn("h-3.5 w-3.5 flex-none", active && "text-primary")} />}
              <span className="max-w-[160px] flex-1 truncate text-left">{tab.title}</span>
              {/* The close X shows on the active tab always and on the others
                  on hover: Notepad's arrangement, less its unsaved dot. */}
              <span
                role="button"
                aria-label={`Close ${tab.title}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.id);
                }}
                className={cn(
                  "flex h-5 w-5 flex-none items-center justify-center rounded transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
                  active ? "opacity-100 hover:bg-foreground/10" : "opacity-0 hover:bg-white/15",
                )}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </button>
          );
        })}
      </div>

      {/* Scroll right. */}
      {openTabs.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scroll tabs right"
          disabled={!canRight}
          onClick={() => scrollStrip(SCROLL_STEP)}
          className={ARROW}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

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
