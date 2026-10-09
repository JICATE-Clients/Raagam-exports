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

import { createElement, useEffect } from "react";
import { useAppUser } from "@/lib/auth/permission-context";
import { Truncated } from "@/components/ui/truncated";
import { hasPermission } from "@/lib/auth/types";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEnsureWorkspaceTab, useOpenWorkspaceTab, useTrackTabSearch, useWorkspaceTabs } from "@/lib/workspace-tabs";
import { NAV } from "@/components/shell/nav";
import { isHubRoute } from "@/lib/nav/module-groups";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { useSearch } from "@/components/search/search-provider";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { isPlainLeftClick, navEntry, navLabel, visibleModules } from "@/components/navigation/navigation-config";
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
 * ONE SCREEN SWITCHER, NOT A ROW OF TABS (user 2026-10-03: option "L" of the
 * twelve tab-strip designs on the Workspace Tabs Redesign canvas, chosen after
 * seeing each one at 390px).
 *
 * The strip used to draw every open screen as a tab (Notepad-style, operator
 * 2026-09-17). On a phone that left room for two and a half tabs, scrolled
 * sideways; on a desktop the open tab was told apart from the rest only by a
 * 2px underline. L names the CURRENT screen once and puts the others one
 * click away:
 *
 *   [Home] [‹] [›] [▣ Order Entry · 3 open ▾]  Recent: Fabric BOM · Material BOM
 *
 * - THE SWITCHER is `DropdownMenu`, so its keyboard (↑↓ Enter Esc) and its
 *   portal are the primitive's. Its list is every open screen, the current one
 *   ticked (`checked`), then the Close current / others / all actions the old
 *   ⋯ menu carried. Closing lives here now: there is no per-tab ✕ any more.
 * - ‹ › STEP THROUGH THE OPEN SCREENS in the store's own order, Home first, and
 *   stop at either end rather than wrap — a wrap reads as a jump to a screen the
 *   operator did not ask for.
 * - "RECENT" is the two most recently OPENED other screens. The store appends,
 *   so the tail of `tabs` is the newest. Desktop only (`lg`); on a phone the
 *   switcher's list is the same thing one tap away.
 * - ON A PHONE (below `md`) Home leaves the strip — the bottom bar's Home is the
 *   same link — and the switcher takes the width between ‹ and ›, so the strip
 *   is three thumb-sized controls whatever the tab count.
 *
 * The unsaved dot stays gone ("antha . mattum vendam", 2026-09-17); the store
 * still tracks `dirty` for the reload guard.
 *
 * Every behaviour is still `lib/workspace-tabs.ts` (open, dedupe, switch,
 * close, close others/all); only how it is drawn changed.
 */
const NAV_BTN =
  "flex h-10 w-10 flex-none items-center justify-center rounded-control border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface md:h-9 md:w-9";

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

  const recent = openTabs
    .filter((t) => t.href !== pathname)
    .slice(-2)
    .reverse();

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
    <div
      data-tab-strip=""
      className="flex h-14 flex-none items-center gap-1.5 border-b border-border px-2 md:h-11 md:gap-1"
    >
      {showHome && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Home"
          aria-current={isHomeActive ? "page" : undefined}
          onClick={(e) => {
            if (!isPlainLeftClick(e)) return;
            goHome();
          }}
          className={cn(NAV_BTN, "max-md:hidden", isHomeActive && "border-primary text-primary")}
        >
          <LayoutDashboard className="h-4 w-4" />
        </button>
      )}

      {/* Chrome, not fields: off the Tab path like every control here. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Previous screen"
        disabled={pos <= 0}
        onClick={() => seq[pos - 1]?.go()}
        className={NAV_BTN}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {/* `max-md:order-last` puts › after the switcher on a phone
          (‹ [switcher] ›); on a desktop it stays beside ‹. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Next screen"
        disabled={pos >= seq.length - 1}
        onClick={() => seq[pos + 1]?.go()}
        className={cn(NAV_BTN, "max-md:order-last")}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <DropdownMenu
        items={switcherItems}
        label={`Open screens, current: ${currentLabel}`}
        align="left"
        triggerClassName="ty-tab flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-surface px-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted md:ml-1 md:h-9 md:max-w-[22rem] md:flex-none"
        trigger={
          <>
            {/* `createElement`, not `<CurrentIcon />`: the icon is looked up per
                render, and React Compiler refuses a component chosen that way
                as JSX (react-hooks/static-components). */}
            {CurrentIcon && createElement(CurrentIcon, { className: "h-4 w-4 flex-none text-primary" })}
            <Truncated text={currentLabel} className="min-w-0 text-left" />
            {openTabs.length > 0 && (
              <span className="ml-auto flex-none rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary md:ml-1">
                {openTabs.length} open
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
          </>
        }
      />

      {recent.length > 0 && (
        <div className="ml-2 hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground lg:flex">
          <span className="flex-none">Recent:</span>
          {recent.map((t, i) => (
            <span key={t.id} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span aria-hidden>·</span>}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => activate(t.id)}
                // truncate-reveal: exempt -- a screen name from the nav registry, and the full name is in the switcher list beside it
                className="max-w-[10rem] truncate font-medium text-primary hover:underline"
              >
                {label(t)}
              </button>
            </span>
          ))}
        </div>
      )}

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
