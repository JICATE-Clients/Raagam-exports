"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  X,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  Building2,
  Truck,
  Users,
  Package,
  ClipboardList,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { type NavItem, type SubNavItem } from "./nav";
import { searchNav, type NavSearchRow } from "./nav-search";
import { type StoreNavLink } from "./sidebar";
import { isHubRoute, owningNavHref } from "@/lib/nav/module-groups";
import { useOverlayFocus } from "@/lib/use-overlay-focus";
import { useAccordion } from "@/lib/ui/use-accordion";
import { confirmDiscard, useModalGuard } from "@/lib/reload-guard";
import { useAppUser } from "@/lib/auth/permission-context";
import { useEditorOpen } from "@/lib/editor-presence";
import { visibleModules } from "@/components/navigation/navigation-config";
import type { SearchEntity, SearchResult } from "@/lib/search/types";
import { cn } from "@/lib/utils";

/**
 * MOBILE BOTTOM TAB BAR (below `md`; the sidebar owns ≥md and is untouched).
 *
 *   Home · <the login's modules, Orders and Approvals first> · Menu
 *
 * Replaced the floating "Peek Sheet" pill + separate ＋ FAB (user, 2026-09-24:
 * "bottom navigation with 4–5 primary items … feel native on iOS and
 * Android"). The pill's job — saying where you are — moved to the Menu tab,
 * which takes the current module's glyph and name whenever that module has no
 * tab of its own. Nothing floats any more, so the bug-reporter button and the
 * toast stack have one fixed edge to clear. The New tab (and its create sheet)
 * was removed on 2026-10-03 (user: "remove the new menu totally, no need");
 * create actions stay on each screen's own "+ Add" button.
 *
 * Four behaviours make it feel like a native tab bar rather than a row of links:
 *
 * - **Tabs remember where you were.** Leaving Orders from a Fabric BOM and
 *   tapping Orders again lands back on that Fabric BOM (`tabTarget`), the way
 *   an iOS / Android tab keeps its own stack. Kept in sessionStorage, so it is
 *   per-tab-of-the-browser and dies with it.
 * - **Tapping the ACTIVE tab goes to its root** — the platform's "pop to root".
 * - **Back closes a sheet, it does not leave the page.** Each sheet pushes one
 *   history entry (`useBackDismiss`); Android's Back button and iOS's edge
 *   swipe pop it. A link inside the sheet REPLACES that entry, so Back from the
 *   destination returns to the page underneath — never to a ghost entry that
 *   just reopens nothing.
 * - **It stands down inside a full-page editor** (`useEditorOpen`), which
 *   carries its own back button and Save / Next row (user 2026-10-03).
 * - **A small login gets its screens as tabs** (`COMPACT_MAX`): Home · My
 *   Profile for a regular staff member, no Menu sheet (2026-10-03).
 * - **Leaving asks first.** A tab tap is a navigation like `BackLink`'s, so it
 *   runs the same `confirmDiscard()` before abandoning a dirty editor.
 */

const ENTITY_ICON: Record<SearchEntity, LucideIcon> = {
  order: ClipboardList,
  invoice: FileText,
  customer: Building2,
  vendor: Truck,
  product: Package,
  employee: Users,
};

/**
 * THE BAR FOLLOWS THE LOGIN'S ALLOCATION (user 2026-10-03, screenshot 3237).
 * It was a fixed Home · Orders · Approvals · Menu, so a login without
 * Approvals simply lost that slot and kept its OWN module behind the Menu —
 * a staff member allocated Orders saw Home · Orders · Menu, with My Profile
 * two levels down a sheet.
 *
 * Now: Home, then `MODULE_SLOTS` module tabs, then Menu. `PREFERRED` modules
 * take the slots first when the login holds them (Orders and Approvals — the
 * old bar, unchanged for anyone who has both); a slot they leave empty goes
 * to the login's next module in sidebar order. A module holding ONE screen is
 * that screen on the bar ("My Profile", not "HR & Payroll").
 */
const PREFERRED: readonly string[] = ["/orders", "/approvals"];
const MODULE_SLOTS = 2;
/** A module's bar label when it differs from its sidebar label. */
const TAB_LABEL: Record<string, string> = { "/": "Home" };

const MEMORY_KEY = "raagam.mobile-tab-memory";

/**
 * A SMALL LOGIN'S BAR HOLDS ITS SCREENS (user 2026-10-03, mockup "Staff Login
 * Bottom Bar", option B). A regular staff member reaches Home and My Profile
 * and nothing else, so the standard bar was Home + a Menu sheet three levels
 * deep (HR & Payroll ▸ People ▸ My Profile) around the one screen they have.
 * At this many screens or fewer, each is its own tab and the Menu tab goes.
 * Four, so Home + 4 is the five a phone bar holds.
 *
 * NO ALERTS TAB. The mockup filled the bar with one; the user struck it the
 * same day ("already top bar have the notification then why its need in
 * bottom too?") — the top bar's bell is on screen everywhere this bar is.
 */
const COMPACT_MAX = 4;

type ScreenTab = { href: string; label: string; icon: LucideIcon };

/**
 * The screens a module holds for this login. Its ROOT counts as one unless it
 * is a hub (a card index the registry declares): `/approvals` is the approval
 * queue itself with Flows beneath it, so it is two screens, not "Approval
 * Flows" — which is what the bar briefly read when only children counted.
 */
function screensOf(
  m: NavItem,
  childrenFor: (href: string, children?: SubNavItem[]) => SubNavItem[],
): { href: string; label: string }[] {
  const leaves = childrenFor(m.href, m.children).flatMap((c) => (c.children?.length ? c.children : [c]));
  const rootIsScreen = leaves.length === 0 || !isHubRoute(m.href);
  return rootIsScreen ? [{ href: m.href, label: m.label }, ...leaves] : leaves;
}

/** Every screen this login can open (not a module row, not a group), or null
 *  once there are more than `COMPACT_MAX` — the standard bar then applies. */
function compactScreens(
  modules: NavItem[],
  childrenFor: (href: string, children?: SubNavItem[]) => SubNavItem[],
): ScreenTab[] | null {
  const out: ScreenTab[] = [];
  const seen = new Set<string>();
  for (const m of modules) {
    if (m.href === "/") continue;
    for (const l of screensOf(m, childrenFor)) {
      if (seen.has(l.href)) continue;
      seen.add(l.href);
      out.push({ href: l.href, label: l.label, icon: m.icon });
      if (out.length > COMPACT_MAX) return null;
    }
  }
  return out.length > 0 ? out : null;
}

function onRoute(pathname: string, href: string) {
  const base = href.split("?")[0];
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}

/** The module a route belongs to — longest match, so /analytics never reads as /. */
function moduleOf(pathname: string, modules: NavItem[]): NavItem | undefined {
  return modules
    .filter((m) => onRoute(pathname, m.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

function readMemory(): Record<string, string> {
  try {
    return JSON.parse(window.sessionStorage.getItem(MEMORY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Remember the CURRENT location against its module. `?new=1&a=…` is a
 *  one-shot create intent (`useCreateIntent`), never a place to come back to. */
function rememberHere(modules: NavItem[]) {
  const { pathname, search } = window.location;
  const mod = moduleOf(pathname, modules);
  if (!mod) return;
  const params = new URLSearchParams(search);
  params.delete("new");
  params.delete("a");
  const qs = params.toString();
  try {
    const memory = readMemory();
    memory[mod.href] = qs ? `${pathname}?${qs}` : pathname;
    window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Private mode / storage blocked: tabs simply open at their root.
  }
}

/**
 * Where a tap on a module's tab goes.
 *
 * `activeHref` is the module the operator is in now. Re-tapping it is "pop to
 * root"; any other tab resumes the screen it was left on, if that screen is
 * still inside the module (a stale entry from before a route move falls back
 * to the root rather than 404ing).
 */
function tabTarget(tabHref: string, activeHref: string | undefined, memory: Record<string, string>) {
  if (tabHref === activeHref) return tabHref;
  const saved = memory[tabHref];
  if (saved && onRoute(saved.split("?")[0], tabHref)) return saved;
  return tabHref;
}

/**
 * One history entry per open sheet, so the platform's Back gesture dismisses
 * it. Next 16 patches `history.pushState` to carry its own router state
 * (`copyNextJsInternalHistoryState` in app-router.js), so an entry pushed here
 * pops back through the router as an ordinary same-URL traverse.
 */
function useBackDismiss(open: boolean, onDismiss: () => void) {
  const router = useRouter();
  const pushed = useRef(false);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    // The ref guard is what keeps StrictMode's double effect from stacking two
    // entries — and two entries would make the first Back look like it did nothing.
    if (!pushed.current) {
      window.history.pushState({ raagamSheet: true }, "");
      pushed.current = true;
    }
    const onPop = () => {
      pushed.current = false;
      dismissRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  return {
    /** Close without navigating: pop our own entry (popstate then dismisses). */
    close() {
      if (pushed.current) window.history.back();
      else dismissRef.current();
    },
    /** Navigate out of the sheet, consuming its entry rather than stacking on it. */
    go(href: string) {
      if (pushed.current) {
        pushed.current = false;
        router.replace(href);
      } else {
        router.push(href);
      }
      dismissRef.current();
    },
  };
}

/** A plain left click we may take over; modified clicks keep the browser's meaning. */
function isPlainClick(e: MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

type Sheet = "menu" | null;

export function MobileNav({ stores = [] }: { stores?: StoreNavLink[] }) {
  // EVERY hook sits above the single early return below (AGENTS.md, "Hooks
  // above every early return").
  const pathname = usePathname();
  const router = useRouter();
  const user = useAppUser();
  // A full-page editor has its own way out (← back, Escape, the platform's
  // Back) and its own bottom row (Save / Next), so the tab bar stands down
  // while one is open (user 2026-10-03): a thumb reaching for Next must not
  // land on Home, and the form gets the 56px back. Same signal that folds the
  // desktop sidebar away (`components/shell/sidebar.tsx`).
  const editorOpen = useEditorOpen();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [query, setQuery] = useState("");
  const [viewHref, setViewHref] = useState<string | null>(null);
  const [records, setRecords] = useState<SearchResult[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  // A group row in the menu folds open to list its screens — the sidebar's
  // third level (user 2026-10-03: "people inside child not showing"). One
  // group open at a time (AGENTS.md "Folds are accordions").
  const fold = useAccordion();

  const modules = useMemo(
    /* 0658: the shared filter — modules AND their screens (navigation-config). */
    () => visibleModules(user),
    [user],
  );

  const dismiss = () => setSheet(null);
  const menuBack = useBackDismiss(sheet === "menu", dismiss);
  const closeSheet = () => menuBack.close();

  useOverlayFocus(sheet === "menu", closeSheet, menuRef);
  // Hand-rolled overlay → declare it, or a silent deploy reload lands under it.
  useModalGuard(sheet !== null);

  // Every arrival is remembered against its module (see `tabTarget`).
  useEffect(() => {
    rememberHere(modules);
  }, [pathname, modules]);

  // Record hits from the shared search API, debounced.
  useEffect(() => {
    const term = query.trim();
    // A short query shows no record hits — derived below, not cleared here.
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { results: SearchResult[] };
        setRecords(data.results ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setRecords([]);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  if (modules.length === 0 || editorOpen) return null;

  const storeLinks: SubNavItem[] = stores.map((s) => ({ href: `/stores/${s.id}`, label: s.name }));
  const childrenFor = (moduleHref: string, children?: SubNavItem[]) =>
    moduleHref === "/stores" ? [...storeLinks, ...(children ?? [])] : (children ?? []);

  // ── Compact bar: a small login's own screens as tabs (`COMPACT_MAX`) ──────
  const compact = compactScreens(modules, childrenFor);
  if (compact) {
    const home = modules.find((m) => m.href === "/");
    const hereHref = compact
      .filter((t) => onRoute(pathname, t.href))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href;
    const go = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!isPlainClick(e)) return;
      e.preventDefault();
      if (!confirmDiscard()) return;
      if (href !== pathname) router.push(href);
    };
    return (
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <div className="mx-auto flex h-14 max-w-xl items-stretch">
          {home && (
            <TabLink
              href="/"
              icon={home.icon}
              label={TAB_LABEL["/"]}
              active={pathname === "/"}
              onClick={(e) => go(e, "/")}
            />
          )}
          {compact.map((t) => (
            <TabLink
              key={t.href}
              href={t.href}
              icon={t.icon}
              label={t.label}
              active={t.href === hereHref}
              onClick={(e) => go(e, t.href)}
            />
          ))}
        </div>
      </nav>
    );
  }

  const activeModule = moduleOf(pathname, modules);
  const homeModule = modules.find((m) => m.href === "/");
  const others = modules.filter((m) => m.href !== "/");
  const moduleTabs = [
    ...PREFERRED.map((href) => others.find((m) => m.href === href)).filter((m): m is NavItem => !!m),
    ...others.filter((m) => !PREFERRED.includes(m.href)),
  ]
    .slice(0, MODULE_SLOTS)
    .map((m) => {
      // One screen in the module → the tab IS that screen.
      const leaves = screensOf(m, childrenFor);
      const only = leaves.length === 1 ? leaves[0] : undefined;
      return { mod: m, href: only?.href ?? m.href, label: only?.label ?? TAB_LABEL[m.href] ?? m.label };
    });
  const tabbed = new Set<string>(["/", ...moduleTabs.map((t) => t.mod.href)]);
  const inPinned = !!activeModule && tabbed.has(activeModule.href);
  // The Menu tab stands in for whichever module has no tab of its own.
  const menuModule = !inPinned ? activeModule : undefined;

  /** The sidebar row that owns this route. A grouped module's leaves are not
   *  paths beneath their group, so prefix matching alone lights nothing. */
  function activeSectionHref(mod: NavItem, sections: SubNavItem[]) {
    return (
      owningNavHref(mod.href, pathname) ??
      sections
        .filter((s) => onRoute(pathname, s.href))
        .sort((a, b) => b.href.length - a.href.length)[0]?.href
    );
  }

  // ── Menu sheet ───────────────────────────────────────────────────────────
  const viewModule = modules.find((m) => m.href === viewHref) ?? activeModule ?? modules[0];
  const viewSections = childrenFor(viewModule.href, viewModule.children);
  const viewActive =
    viewModule.href === activeModule?.href ? activeSectionHref(viewModule, viewSections) : undefined;

  const q = query.trim();
  const results: NavSearchRow[] = q
    ? [
        ...searchNav(query, modules, childrenFor, user),
        ...(q.length >= 2 ? records : []).map((r) => ({
          key: `${r.type}:${r.id}`,
          icon: ENTITY_ICON[r.type],
          title: r.title,
          sub: r.subtitle,
          href: r.href,
        })),
      ]
    : [];

  function openSheet(next: Exclude<Sheet, null>) {
    if (sheet === next) return closeSheet();
    setQuery("");
    setViewHref(activeModule?.href ?? null);
    // Open on the group holding the current screen, so "where am I" is visible.
    fold.setOpenKey(
      activeModule ? (activeSectionHref(activeModule, childrenFor(activeModule.href, activeModule.children)) ?? null) : null,
    );
    setSheet(next);
  }

  function onTab(e: MouseEvent<HTMLAnchorElement>, mod: NavItem, rootHref: string = mod.href) {
    if (!isPlainClick(e)) return; // long-press / new tab keeps the plain href
    e.preventDefault();
    if (!confirmDiscard()) return;
    rememberHere(modules); // capture this screen's latest filters before leaving
    // A one-screen module's tab goes to that screen; memory cannot improve on it.
    const target =
      rootHref !== mod.href ? rootHref : tabTarget(mod.href, activeModule?.href, readMemory());
    if (target !== pathname + window.location.search) router.push(target);
  }

  /** A link inside a sheet: replace the sheet's history entry, see `useBackDismiss`. */
  function sheetLink(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    if (!confirmDiscard()) return;
    menuBack.go(href);
  }

  const MenuIcon = menuModule?.icon ?? LayoutGrid;

  return (
    <>
      {/* Tab bar. `pb-[env(safe-area-inset-bottom)]` keeps the tabs above the
          iOS home indicator (viewportFit: "cover" is set in app/layout.tsx); on
          Android and on a phone without the indicator it resolves to 0. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <div className="mx-auto flex h-14 max-w-xl items-stretch">
          {homeModule && (
            <TabLink
              href="/"
              icon={homeModule.icon}
              label={TAB_LABEL["/"]}
              active={sheet === null && activeModule?.href === "/"}
              onClick={(e) => onTab(e, homeModule)}
            />
          )}
          {moduleTabs.map((t) => (
            <TabLink
              key={t.mod.href}
              href={t.href}
              icon={t.mod.icon}
              label={t.label}
              active={sheet === null && activeModule?.href === t.mod.href}
              onClick={(e) => onTab(e, t.mod, t.href)}
            />
          ))}
          <TabButton
            icon={MenuIcon}
            label={menuModule?.label ?? "Menu"}
            active={sheet === "menu" || (sheet === null && !!menuModule)}
            onClick={() => openSheet("menu")}
            ariaLabel={menuModule ? `Menu — in ${menuModule.label}` : "Menu"}
          />
        </div>
      </nav>

      {/* Scrim behind the menu sheet. */}
      <div
        aria-hidden
        onClick={closeSheet}
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 md:hidden",
          sheet ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* ── Menu sheet ─────────────────────────────────────────────────── */}
      <BottomSheet
        panelRef={menuRef}
        open={sheet === "menu"}
        label="Menu"
        header={
          <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              // caps-input: exempt -- a search query is not a stored value
              // A raw <input>, so it carries the autofill opt-outs itself
              // (AGENTS.md "Browser autofill").
              type="search"
              autoComplete="off"
              data-1p-ignore=""
              data-lpignore="true"
              data-form-type="other"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search records, screens, actions…"
              aria-label="Search"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <CloseButton onClick={closeSheet} />
          </div>
        }
      >
        {q ? (
          <>
            <SectionLabel>
              {results.length} result{results.length !== 1 ? "s" : ""}
            </SectionLabel>
            {results.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No matches.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                {results.slice(0, 30).map((r) => {
                  const Icon = r.icon;
                  return (
                    <li key={r.key}>
                      <Link href={r.href} onClick={(e) => sheetLink(e, r.href)} className={ROW}>
                        <Icon className={cn("h-4 w-4 shrink-0", r.isAction ? "text-primary" : "text-muted-foreground")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{r.title}</span>
                          <span className="block truncate text-xs font-normal text-muted-foreground">{r.sub}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <SectionLabel>{viewModule.label}</SectionLabel>
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
              <li>
                <Link
                  href={viewModule.href}
                  onClick={(e) => sheetLink(e, viewModule.href)}
                  aria-current={pathname === viewModule.href ? "page" : undefined}
                  className={cn(ROW, pathname === viewModule.href && ROW_ON)}
                >
                  <viewModule.icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{viewModule.label} overview</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
              {viewSections.map((s) => {
                const on = s.href === viewActive;
                const leaves = s.children ?? [];
                if (leaves.length === 0) {
                  return (
                    <li key={s.href}>
                      <Link
                        href={s.href}
                        onClick={(e) => sheetLink(e, s.href)}
                        aria-current={on ? "page" : undefined}
                        className={cn(ROW, "pl-9", on && ROW_ON)}
                      >
                        <span className="min-w-0 flex-1 truncate">{s.label}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                }
                // A group: the row folds open to its screens instead of
                // opening the hub page — that is a second tap to reach a screen.
                const open = fold.isOpen(s.href);
                const leafOn = on
                  ? leaves
                      .filter((c) => onRoute(pathname, c.href))
                      .sort((a, b) => b.href.length - a.href.length)[0]?.href
                  : undefined;
                return (
                  <li key={s.href}>
                    <button
                      type="button"
                      onClick={() => fold.toggle(s.href)}
                      aria-expanded={open}
                      className={cn(ROW, "pl-9", on && !open && ROW_ON)}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">{leaves.length}</span>
                      <ChevronDown
                        className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                      />
                    </button>
                    {open && (
                      <ul className="border-t border-border bg-surface-muted/40">
                        {leaves.map((c) => {
                          const here = c.href === leafOn;
                          return (
                            <li key={c.href}>
                              <Link
                                href={c.href}
                                onClick={(e) => sheetLink(e, c.href)}
                                aria-current={here ? "page" : undefined}
                                className={cn(ROW, "bg-transparent pl-14 font-normal", here && ROW_ON)}
                              >
                                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

            <SectionLabel className="mt-4">Modules</SectionLabel>
            <div className="grid grid-cols-4 gap-1">
              {modules.map((m) => {
                const on = m.href === viewModule.href;
                const here = m.href === activeModule?.href;
                return (
                  // button-shape: exempt -- a 4-column grid of module tiles in the bottom sheet, navigation rather than a word toggle row
                  <button
                    key={m.href}
                    type="button"
                    onClick={() => {
                      setViewHref(m.href);
                      fold.setOpenKey(null);
                    }}
                    aria-pressed={on}
                    className={cn(
                      "flex min-h-16 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-center [-webkit-tap-highlight-color:transparent] active:bg-surface-muted",
                      on ? "bg-primary-soft text-primary" : "text-foreground",
                    )}
                  >
                    <span className="relative">
                      <m.icon className="h-5 w-5" />
                      {here && !on && (
                        <span aria-hidden className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </span>
                    <span className="line-clamp-2 text-[11px] font-medium leading-tight">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </BottomSheet>
    </>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/** A dense list row: 44px, the minimum comfortable touch target. */
const ROW =
  "flex min-h-11 w-full items-center gap-3 bg-surface px-3 py-2 text-left text-sm font-medium text-foreground [-webkit-tap-highlight-color:transparent] active:bg-surface-muted";
const ROW_ON = "bg-primary-soft text-primary";

/** Shared tab chrome. Indicator = a tinted pill behind the icon (Material 3)
 *  plus a coloured, heavier label (iOS) — two signals, so the active tab reads
 *  in either convention and without relying on colour alone. */
function TabInner({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active: boolean }) {
  return (
    <>
      <span
        className={cn(
          "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
          active && "bg-primary-soft",
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
      </span>
      <span className={cn("max-w-full truncate px-0.5 text-[11px] leading-none", active ? "font-semibold" : "font-medium")}>
        {label}
      </span>
    </>
  );
}

const TAB =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 select-none outline-none [-webkit-tap-highlight-color:transparent] focus-visible:bg-surface-muted";

function TabLink({
  href,
  icon,
  label,
  active,
  onClick,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(TAB, active ? "text-primary" : "text-muted-foreground")}
    >
      <TabInner icon={icon} label={label} active={active} />
    </Link>
  );
}

function TabButton({
  icon,
  label,
  active,
  disabled,
  onClick,
  ariaLabel,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={active}
      className={cn(
        TAB,
        active ? "text-primary" : "text-muted-foreground",
        "disabled:opacity-40",
      )}
    >
      <TabInner icon={icon} label={label} active={active} />
    </button>
  );
}

/**
 * Bottom sheet. Never unmounted, only slid away — so it is `inert` while
 * closed, or its links stay in the page's Tab order and in the screen reader's
 * reading order (client 2026-07-25, same fix as components/ui/sheet.tsx).
 * `role="dialog"` only while open: the reload guard's DOM scan counts dialogs.
 * Escape is `useOverlayFocus`'s document listener — a second one here would
 * close it twice, i.e. pop two history entries and leave the page.
 */
function BottomSheet({
  open,
  label,
  header,
  children,
  panelRef,
}: {
  open: boolean;
  label: string;
  header: ReactNode;
  children: ReactNode;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      inert={!open}
      aria-hidden={!open}
      role={open ? "dialog" : undefined}
      aria-modal={open ? true : undefined}
      aria-label={label}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] transition-transform duration-200 md:hidden",
        open ? "translate-y-0" : "translate-y-full",
      )}
      style={{ transitionTimingFunction: "cubic-bezier(.2,.84,.24,1)" }}
    >
      <div className="shrink-0 px-4 pb-2 pt-2">
        <div aria-hidden className="mx-auto mb-2 h-1 w-8 rounded-full bg-border" />
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-1">{children}</div>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-surface-muted"
    >
      <X className="h-4 w-4" />
    </button>
  );
}

function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1.5 flex items-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", className)}>
      {children}
    </div>
  );
}
