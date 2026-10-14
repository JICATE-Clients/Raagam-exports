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
 * already owns. The switcher's DROPDOWN does list them again (user
 * 2026-10-12, `siblingScreens`) — one menu away, not a second always-on row,
 * and it covers Master Data's hub entities, which the sidebar never lists.
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

import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { useAppUser } from "@/lib/auth/permission-context";
import { Truncated } from "@/components/ui/truncated";
import { hasPermission } from "@/lib/auth/types";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEnsureWorkspaceTab, useOpenWorkspaceTab, useTrackTabSearch, useWorkspaceTabs } from "@/lib/workspace-tabs";
import { NAV } from "@/components/shell/nav";
import { isHubRoute } from "@/lib/nav/module-groups";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { useSearch } from "@/components/search/search-provider";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { isPlainLeftClick, isRouteActive, navEntry, navLabel, siblingScreens, visibleModules } from "@/components/navigation/navigation-config";
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
 * NOTEPAD-STYLE TABS ON A DESKTOP, THE ONE SWITCHER ON A PHONE (user
 * 2026-10-14, a Windows Notepad screenshot: "navigation tab intha mari venum").
 *
 * The history, because this is the third shape and the second time it is
 * tabs. 2026-09-17 drew every open screen as a Notepad tab. 2026-10-03
 * replaced that with ONE switcher (option "L" of the Workspace Tabs Redesign
 * canvas), chosen after seeing each design at 390px — on a phone the tabs left
 * room for two and a half, scrolled sideways. Today's request brings the tabs
 * back where they were never the problem: from `md` up the strip is tabs
 * again; below `md` it is still L's three thumb-sized controls (‹ switcher ›).
 *
 * THE DESKTOP STRIP, as Notepad draws it:
 * - a tab per open screen, sitting on the bar's bottom edge. The OPEN one takes
 *   the page's own surface, rounded on top and bordered on three sides, so it
 *   reads as joined to the screen beneath; the rest are flat text separated by
 *   a short hairline (none beside the open tab — its own edge separates).
 * - ✕ always on the open tab, on hover on the others.
 * - ◀ ▶ appear only while the strip overflows — two dead arrows around one tab
 *   read as an unfinished bar (user 2026-10-01).
 * - "+" opens Search, the app's way to open another screen.
 * - ▾ keeps the switcher's list: every open screen, the current sub-module's
 *   screens (user 2026-10-12, `siblingScreens`), and Close current / others /
 *   all.
 *
 * NO UNSAVED DOT, though Notepad has one: "antha . mattum vendam" (operator,
 * 2026-09-17). The store still tracks `dirty` for the reload guard.
 *
 * Every behaviour is still `lib/workspace-tabs.ts` (open, dedupe, switch,
 * close, close others/all); only how it is drawn changed.
 */
const NAV_BTN =
  "flex h-10 w-10 flex-none items-center justify-center rounded-control border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface md:h-9 md:w-9";

/** A desktop tab. `self-end` + `h-9` puts it on the bar's bottom edge. */
const TAB =
  "ty-tab group relative flex h-9 flex-none items-center gap-2 self-end whitespace-nowrap rounded-t-lg border border-b-0 border-transparent pl-3 pr-1.5 text-[13px] transition-colors duration-150";
/** The open tab: the page's surface, joined to it (`-mb-px` covers the bar's rule). */
const TAB_ACTIVE = "z-10 -mb-px h-[calc(2.25rem+1px)] border-border bg-background font-semibold text-foreground";
const TAB_IDLE = "font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground";
/** The hairline on an idle tab's right edge. */
const TAB_DIVIDER =
  "after:absolute after:right-0 after:top-1/2 after:h-4 after:w-px after:-translate-y-1/2 after:bg-border";
const ICON_BTN =
  "flex h-8 w-8 flex-none items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";
/** How far one arrow press moves the strip — roughly one tab. */
const SCROLL_STEP = 180;

export function WorkspaceTabsBar() {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenWorkspaceTab();
  const search = useSearch();

  // Keep the CURRENT route present as a tab — but only when it's a real
  // destination. A hub page (a module root or a group's own card index)
  // never registers one, so drilling down through the hierarchy on the way
  // to a screen leaves no trail of tabs behind it; the sidebar already shows
  // that path. `useEnsureWorkspaceTab` never overwrites a title a caller
  // already set (the sidebar's click, or a screen's own
  // useRegisterWorkspaceTab) — only fills one in when creating the tab fresh.
  useEnsureWorkspaceTab({
    href: pathname,
    title: navLabel(user, pathname, titleForPath(pathname)),
    skip: pathname === "/" || isHubRoute(pathname),
  });

  const { tabs, activate, close, closeOthers, closeAll, mergeSameScreen } = useWorkspaceTabs();
  // Remember each screen's query string, so the tab returns to where the operator
  // left (user 2026-10-09: "enth screen la erunthu exit akarangolo thirumba anga").
  const searchNow = useSearchParams().toString();
  useTrackTabSearch(pathname, searchNow);

  // One screen, one tab: a staff member's `/hr/staff` IS their own record
  // (`navEntry`), so a tab left on the list and the record's own tab are
  // folded together rather than both reading "My Profile".
  useEffect(() => {
    mergeSameScreen((href) => navEntry(user, { href, label: "" }).href);
  }, [user, tabs, mergeSameScreen]);

  /* 0658: the shared filter — modules AND their screens (navigation-config). */
  const modules = visibleModules(user);
  const showHome = hasPermission(user, "dashboard", "view");
  const isHomeActive = pathname === "/";
  // Home is drawn once, fixed, ahead of the list — see the file header.
  const openTabs = tabs.filter((t) => t.href !== "/");
  // Resolved from the route on screen, not the store's `activeId`, which can
  // lag one route behind on a hub page (nothing registers a tab there).
  const currentTab = openTabs.find((t) => t.href === pathname);
  const label = (t: { href: string; title: string }) => navLabel(user, t.href, t.title);
  const goHome = () => openTab({ href: "/", title: "Home" });

  /* THE SEQUENCE ‹ › WALK: Home (when the operator may see it), then the open
     screens. `pos` is -1 on a route that is in neither (a hub page), so ›
     goes to the first and ‹ has nowhere to go. */
  const seq: { key: string; go: () => void }[] = [
    ...(showHome ? [{ key: "/", go: goHome }] : []),
    ...openTabs.map((t) => ({ key: t.href, go: () => activate(t.id) })),
  ];
  const pos = seq.findIndex((s) => s.key === pathname);

  const CurrentIcon = isHomeActive ? LayoutDashboard : iconForPath(pathname, modules);
  const currentLabel = isHomeActive
    ? "Home"
    : currentTab
      ? label(currentTab)
      : navLabel(user, pathname, titleForPath(pathname));

  const siblings = isHomeActive ? null : siblingScreens(user, pathname);

  const homeItem: DropdownItem[] = showHome
    ? [{ label: "Home", icon: LayoutDashboard, onClick: goHome, checked: isHomeActive, section: "Open screens" }]
    : [];
  const switcherItems: DropdownItem[] = [
    ...homeItem,
    ...openTabs.map(
      (t): DropdownItem => ({
        label: label(t),
        icon: iconForPath(t.href, modules),
        onClick: () => activate(t.id),
        checked: t.href === pathname,
        section: "Open screens",
      }),
    ),
    // The current sub-module's screens (user 2026-10-12) — one pick to a
    // neighbour; the screen on view is ticked here as well as above.
    ...(siblings?.rows ?? []).map(
      (r): DropdownItem => ({
        label: r.label,
        icon: iconForPath(r.href, modules),
        onClick: () => openTab({ href: r.href, title: r.label }),
        checked: isRouteActive(pathname, r.href),
        section: siblings!.label,
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

  /* ARROWS INSTEAD OF A SCROLLBAR, Notepad's answer to more tabs than fit —
     each live only while there is somewhere to go in its direction. */
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const overflowing = canLeft || canRight;
  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);
  // A tab opened or closed changes the content, not the strip's size; and the
  // open tab is scrolled into view so it is never left past the edge.
  useEffect(() => {
    measure();
    stripRef.current
      ?.querySelector<HTMLElement>('[data-tab-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [measure, openTabs.length, pathname]);
  const scrollStrip = (dx: number) => stripRef.current?.scrollBy({ left: dx, behavior: "smooth" });

  return (
    <div
      data-tab-strip=""
      className="flex h-14 flex-none items-center gap-1.5 border-b border-border px-2 md:h-11 md:gap-1"
    >
      {/* ---- PHONE (below md): L's three controls, ‹ [switcher] › ---- */}
      {/* Chrome, not fields: off the Tab path like every control here. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Previous screen"
        disabled={pos <= 0}
        onClick={() => seq[pos - 1]?.go()}
        className={cn(NAV_BTN, "md:hidden")}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 flex-1 md:hidden">
        <DropdownMenu
          items={switcherItems}
          label={`Open screens, current: ${currentLabel}`}
          align="left"
          triggerClassName="ty-tab flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-surface px-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted"
          trigger={
            <>
              {/* `createElement`, not `<CurrentIcon />`: the icon is looked up per
                  render, and React Compiler refuses a component chosen that way
                  as JSX (react-hooks/static-components). */}
              {CurrentIcon && createElement(CurrentIcon, { className: "h-4 w-4 flex-none text-primary" })}
              <Truncated text={currentLabel} className="min-w-0 text-left" />
              {openTabs.length > 0 && (
                <span className="ml-auto flex-none rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {openTabs.length} open
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
            </>
          }
        />
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Next screen"
        disabled={pos >= seq.length - 1}
        onClick={() => seq[pos + 1]?.go()}
        className={cn(NAV_BTN, "md:hidden")}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* ---- DESKTOP (md and up): Notepad's tab strip ---- */}
      {showHome && (
        <button
          type="button"
          tabIndex={-1}
          aria-current={isHomeActive ? "page" : undefined}
          onClick={(e) => {
            if (!isPlainLeftClick(e)) return;
            goHome();
          }}
          className={cn(TAB, "gap-1.5 pr-3 max-md:hidden", isHomeActive ? TAB_ACTIVE : TAB_IDLE)}
        >
          <LayoutDashboard className={cn("h-3.5 w-3.5 flex-none", isHomeActive && "text-primary")} />
          Home
        </button>
      )}
      {overflowing && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scroll tabs left"
          disabled={!canLeft}
          onClick={() => scrollStrip(-SCROLL_STEP)}
          className={cn(ICON_BTN, "self-center max-md:hidden")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {/* THE STRIP. `h-full items-end` so each tab sits on the bar's bottom
          edge; no scrollbar, the arrows are the way along it. */}
      <div ref={stripRef} className="scrollbar-none flex h-full min-w-0 items-end overflow-x-auto max-md:hidden">
        {openTabs.map((tab, i) => {
          const active = tab.href === pathname;
          const Icon = iconForPath(tab.href, modules);
          const name = label(tab);
          /* No hairline on the open tab, nor on the one just before it. */
          const divider = !active && openTabs[i + 1]?.href !== pathname;
          return (
            <button
              key={tab.id}
              type="button"
              tabIndex={-1}
              data-tab-active={active}
              aria-current={active ? "page" : undefined}
              onClick={() => activate(tab.id)}
              onAuxClick={(e) => {
                // Middle-click closes, as in every tabbed app.
                if (e.button === 1) {
                  e.preventDefault();
                  close(tab.id);
                }
              }}
              className={cn(TAB, "min-w-[8rem]", active ? TAB_ACTIVE : TAB_IDLE, divider && TAB_DIVIDER)}
            >
              {Icon && createElement(Icon, { className: cn("h-3.5 w-3.5 flex-none", active && "text-primary") })}
              <Truncated text={name} className="max-w-[10rem] flex-1 text-left" />
              <span
                role="button"
                aria-label={`Close ${name}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.id);
                }}
                className={cn(
                  "flex h-6 w-6 flex-none items-center justify-center rounded transition-opacity duration-150 hover:bg-foreground/10 group-hover:opacity-100",
                  active ? "opacity-100" : "opacity-0",
                )}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </button>
          );
        })}
      </div>
      {overflowing && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scroll tabs right"
          disabled={!canRight}
          onClick={() => scrollStrip(SCROLL_STEP)}
          className={cn(ICON_BTN, "self-center max-md:hidden")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open a screen"
        title="Open a screen (⌘K)"
        onClick={search.open}
        className={cn(ICON_BTN, "self-center max-md:hidden")}
      >
        <Plus className="h-4 w-4" />
      </button>
      <div className="self-center max-md:hidden">
        <DropdownMenu
          items={switcherItems}
          label="All open screens"
          align="left"
          trigger={<MoreHorizontal className="h-4 w-4" />}
          triggerClassName={ICON_BTN}
        />
      </div>

      <div className="hidden flex-1 md:block" />

      {/* THE TOOLS THE TOP BAR USED TO CARRY (desktop; the phone keeps
          `Topbar`). Unit, role preview, account, theme and appearance went to
          `SidebarDock`; what stays up here is what is glanced at or reached
          for mid-task — search and the bell. */}
      <div className="ml-1 hidden flex-none items-center gap-0.5 border-l border-border pl-2 md:flex">
        <button
          type="button"
          tabIndex={-1}
          onClick={search.open}
          aria-label="Search everywhere"
          className="flex h-9 w-52 items-center gap-2 rounded-control bg-surface-muted px-2.5 text-xs text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:text-foreground lg:w-60"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
        <NotificationsBell />
      </div>
    </div>
  );
}
