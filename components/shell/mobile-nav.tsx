"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Star,
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
import { isHubRoute } from "@/lib/nav/module-groups";
import { useOverlayFocus } from "@/lib/use-overlay-focus";
import { confirmDiscard, useModalGuard } from "@/lib/reload-guard";
import { useAppUser } from "@/lib/auth/permission-context";
import { useEditorOpen } from "@/lib/editor-presence";
import { visibleModules } from "@/components/navigation/navigation-config";
import type { SearchEntity, SearchResult } from "@/lib/search/types";
import { cn } from "@/lib/utils";

/**
 * MOBILE BOTTOM TAB BAR (below `md`; the sidebar owns ≥md and is untouched).
 *
 *   Home · <the login's modules, Orders and Approvals first> · More (past 4)
 *
 * Replaced the floating "Peek Sheet" pill + separate ＋ FAB (user, 2026-09-24:
 * "bottom navigation with 4–5 primary items … feel native on iOS and
 * Android"). Nothing floats, so the bug-reporter button and the toast stack
 * have one fixed edge to clear. The New tab (and its create sheet) was removed
 * on 2026-10-03 (user: "remove the new menu totally, no need"); create actions
 * stay on each screen's own "+ Add" button.
 *
 * What makes it feel like a native tab bar rather than a row of links:
 *
 * - **Back closes a sheet, it does not leave the page.** Each sheet pushes one
 *   history entry (`useBackDismiss`); Android's Back button and iOS's edge
 *   swipe pop it. A link inside the sheet REPLACES that entry, so Back from the
 *   destination returns to the page underneath — never to a ghost entry that
 *   just reopens nothing.
 * - **It stands down inside a full-page editor** (`useEditorOpen`), which
 *   carries its own back button and Save / Next row (user 2026-10-03).
 * - **Home + the login's modules** (2026-11-04, see `PREFERRED`): a module tab
 *   opens its screens as big tiles; the folding Menu tree is gone.
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
 * THE BAR IS HOME + THE LOGIN'S MODULES (user 2026-11-04, plan v3
 * https://claude.ai/artifact/Vk5K2FhmeCD2JzoMn51dFs: "think easier" — after two
 * richer plans were turned down). Three statements, nothing else:
 *
 * - The bar is Home, then each module the role holds (`PREFERRED` first).
 * - Tapping a module opens its screens as BIG TILES — one more tap and you are
 *   there. A module holding ONE screen is that screen ("My Profile").
 * - Past `MAX_MODULE_TABS` modules, the last slot is More: module tiles → screen tiles.
 *
 * What went: the Menu sheet's folding tree (overview row, sections, counts), the
 * Menu tab borrowing the current module's face, the compact screens-as-tabs bar,
 * and per-tab screen memory. A driver now sees Home · Transport; a store keeper
 * Home · Purchase. NO ALERTS TAB still holds (user 2026-10-03): the bell is in
 * the top bar.
 */
// "/comms" replaced "/approvals" (2026-11-06): the queue is Pulse ▸ My Approvals now.
const PREFERRED: readonly string[] = ["/orders", "/comms"];
/** Home + 4 is the five a phone bar holds; a fifth module turns slot 4 into More. */
const MAX_MODULE_TABS = 4;
/** A module's bar label when it differs from its sidebar label. */
const TAB_LABEL: Record<string, string> = { "/": "Favourites" };
/** The first tab's two routes (user 2026-11-13): on a phone `/` and `/favourites` render the
 *  same page — Favourites with Home inside it — so there is no Home tab and no second
 *  Favourites tab. Desktop keeps both rail items. */
const FIRST_TAB_ROUTES = ["/", "/favourites"];

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

type Tile = { href: string; label: string; icon: LucideIcon };
type TileGroup = { label: string | null; tiles: Tile[] };

/**
 * A module's screens as tile groups: loose screens first (unlabelled), then one
 * group per sub-module under its own small heading. ONE level — a heading is a
 * label, never a fold. Each tile wears its sub-module's icon, so the icon says
 * which family a screen belongs to rather than decorating it.
 */
function tileGroupsOf(
  m: NavItem,
  childrenFor: (href: string, children?: SubNavItem[]) => SubNavItem[],
): TileGroup[] {
  const sections = childrenFor(m.href, m.children);
  const loose: Tile[] = [];
  const groups: TileGroup[] = [];
  const hasLeaves = sections.length > 0;
  // A child that IS the module root (Pulse ▸ Messages → /comms) already gives the
  // root a tile under its own name; an "Overview" beside it was a second tile to the
  // same screen, and a duplicate React key.
  const rootListed = sections.some((s) => s.href === m.href);
  if ((!hasLeaves || !isHubRoute(m.href)) && !rootListed) loose.push({ href: m.href, label: hasLeaves ? "Overview" : m.label, icon: m.icon });
  for (const s of sections) {
    const icon = s.icon ?? m.icon;
    if (s.children?.length) groups.push({ label: s.label, tiles: s.children.map((c) => ({ href: c.href, label: c.label, icon })) });
    else loose.push({ href: s.href, label: s.label, icon });
  }
  return [...(loose.length ? [{ label: null, tiles: loose }] : []), ...groups];
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

/** Which sheet is up: one module's screen tiles, or More (its module tiles, then
 *  — once one is picked — that module's screen tiles, with a way back). */
type Sheet = { more: boolean; module: string | null } | null;

export function MobileNav({ stores = [] }: { stores?: StoreNavLink[] }) {
  // EVERY hook sits above the single early return below (AGENTS.md, "Hooks
  // above every early return").
  const pathname = usePathname();
  const user = useAppUser();
  // A full-page editor has its own way out (← back, Escape, the platform's
  // Back) and its own bottom row (Save / Next), so the tab bar stands down
  // while one is open (user 2026-10-03): a thumb reaching for Next must not
  // land on Home, and the form gets the 56px back. Same signal that folds the
  // desktop sidebar away (`components/shell/sidebar.tsx`).
  const editorOpen = useEditorOpen();
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<SearchResult[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const modules = useMemo(
    /* 0658: the shared filter — modules AND their screens (navigation-config). */
    () => visibleModules(user),
    [user],
  );

  const dismiss = () => setSheet(null);
  const sheetBack = useBackDismiss(sheet !== null, dismiss);
  const closeSheet = () => sheetBack.close();

  useOverlayFocus(sheet !== null, closeSheet, menuRef);
  // Hand-rolled overlay → declare it, or a silent deploy reload lands under it.
  useModalGuard(sheet !== null);

  // Record hits from the shared search API, debounced (More's search box).
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
  // The live stores go under the module's Overview (2026-11-06), which stays the first row.
  const childrenFor = (moduleHref: string, children?: SubNavItem[]) => {
    if (moduleHref !== "/stores") return children ?? [];
    const [first, ...rest] = children ?? [];
    return first?.href === "/stores/overview" ? [first, ...storeLinks, ...rest] : [...storeLinks, ...(children ?? [])];
  };

  const activeModule = moduleOf(pathname, modules);
  const homeModule = modules.find((m) => m.href === "/");
  const shown = modules.filter((m) => !m.hidden);
  const others = [
    ...PREFERRED.map((href) => shown.find((m) => m.href === href)).filter((m): m is NavItem => !!m),
    ...shown.filter((m) => !FIRST_TAB_ROUTES.includes(m.href) && !PREFERRED.includes(m.href)),
  ];
  const overflow = others.length > MAX_MODULE_TABS;
  const tabs = overflow ? others.slice(0, MAX_MODULE_TABS - 1) : others;
  const moreModules = overflow ? others.slice(MAX_MODULE_TABS - 1) : [];
  const inMore = !!activeModule && moreModules.some((m) => m.href === activeModule.href);

  /** The screen tile the operator stands on — longest match, so a parent never lights too. */
  const hereHref = (tiles: Tile[]) =>
    tiles.filter((t) => onRoute(pathname, t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  function go(href: string) {
    if (!confirmDiscard()) return;
    if (href !== pathname) router.push(href);
  }

  function onModuleTab(e: MouseEvent<HTMLAnchorElement>, m: NavItem) {
    if (!isPlainClick(e)) return; // long-press / new tab keeps the plain href
    e.preventDefault();
    const screens = screensOf(m, childrenFor);
    // One screen → the tab IS that screen; nothing to choose between.
    if (screens.length <= 1) return go(screens[0]?.href ?? m.href);
    setQuery("");
    setSheet({ more: false, module: m.href });
  }

  function openMore() {
    if (sheet?.more) return closeSheet();
    setQuery("");
    setSheet({ more: true, module: null });
  }

  /** A link inside a sheet: replace the sheet's history entry, see `useBackDismiss`. */
  function sheetLink(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    if (!confirmDiscard()) return;
    sheetBack.go(href);
  }

  const sheetModule = sheet?.module ? modules.find((m) => m.href === sheet.module) : undefined;
  const q = query.trim();
  const results: NavSearchRow[] =
    sheet?.more && !sheetModule && q
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

  const tabLabel = (m: NavItem) => {
    const screens = screensOf(m, childrenFor);
    return screens.length === 1 ? screens[0].label : (TAB_LABEL[m.href] ?? m.label);
  };

  return (
    <>
      {/* Tab bar. `pb-[env(safe-area-inset-bottom)]` keeps the tabs above the
          iOS home indicator (viewportFit: "cover" is set in app/layout.tsx); on
          Android and on a phone without the indicator it resolves to 0. */}
      <nav
        data-mobile-tabbar=""
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <div className="mx-auto flex h-14 max-w-xl items-stretch">
          {homeModule && (
            <TabLink
              href="/"
              icon={Star}
              label={TAB_LABEL["/"]}
              active={sheet === null && FIRST_TAB_ROUTES.includes(pathname)}
              onClick={(e) => {
                if (!isPlainClick(e)) return;
                e.preventDefault();
                go("/");
              }}
            />
          )}
          {tabs.map((m) => (
            <TabLink
              key={m.href}
              href={m.href}
              icon={m.icon}
              label={tabLabel(m)}
              active={sheet ? sheet.module === m.href && !sheet.more : activeModule?.href === m.href}
              onClick={(e) => onModuleTab(e, m)}
            />
          ))}
          {overflow && (
            <TabButton
              icon={LayoutGrid}
              label="More"
              active={sheet ? sheet.more : inMore}
              onClick={openMore}
              ariaLabel="More modules"
            />
          )}
        </div>
      </nav>

      {/* Scrim behind the sheet. */}
      <div
        aria-hidden
        onClick={closeSheet}
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 md:hidden",
          sheet ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <BottomSheet
        panelRef={menuRef}
        open={sheet !== null}
        label={sheetModule?.label ?? "More"}
        header={
          <div className="flex min-h-11 items-center gap-1">
            {sheet?.more && sheetModule && (
              <button
                type="button"
                onClick={() => setSheet({ more: true, module: null })}
                aria-label="Back to all modules"
                className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-surface-muted"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {sheet?.more && !sheetModule ? (
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                {/* caps-input: exempt -- a search query, not a stored value */}
                <input
                  type="search"
                  autoComplete="off"
                  data-1p-ignore=""
                  data-lpignore="true"
                  data-form-type="other"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search records, screens…"
                  aria-label="Search"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            ) : (
              <h2 className="min-w-0 flex-1 truncate text-base font-bold text-heading">{sheetModule?.label}</h2>
            )}
            <CloseButton onClick={closeSheet} />
          </div>
        }
      >
        {sheetModule ? (
          // ONE MODULE'S SCREENS AS BIG TILES — headings are labels, never folds.
          (() => {
            const groups = tileGroupsOf(sheetModule, childrenFor);
            const all = groups.flatMap((g) => g.tiles);
            const here = hereHref(all);
            // A small module (a driver's Transport) gets two big columns; a big one
            // (Orders, ~20 screens) gets three, so it is not a page of scrolling.
            const wide = all.length <= 6;
            return groups.map((g, gi) => (
              <div key={g.label ?? `loose-${gi}`} className={gi > 0 ? "mt-4" : undefined}>
                {g.label && <SectionLabel>{g.label}</SectionLabel>}
                <ul className={cn("grid gap-2", wide ? "grid-cols-2" : "grid-cols-3")}>
                  {g.tiles.map((t) => (
                    <li key={t.href}>
                      <Link
                        href={t.href}
                        onClick={(e) => sheetLink(e, t.href)}
                        aria-current={t.href === here ? "page" : undefined}
                        className={cn(
                          "flex h-full flex-col items-center justify-center gap-2 rounded-2xl border px-1.5 py-3 text-center [-webkit-tap-highlight-color:transparent] active:scale-[0.97]",
                          wide ? "min-h-[92px]" : "min-h-[84px]",
                          t.href === here ? "border-primary/40 bg-primary-soft text-primary" : "border-border bg-surface text-foreground",
                        )}
                      >
                        <span className="grid size-11 place-items-center rounded-[13px] bg-primary-soft text-primary">
                          <t.icon className="h-5 w-5" />
                        </span>
                        {/* truncate-reveal: exempt -- screen names, two lines allowed; the whole name is the link's text */}
                        <span className={cn("line-clamp-2 font-semibold leading-tight", wide ? "text-[13px]" : "text-[12px]")}>{t.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ));
          })()
        ) : q ? (
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
                          {/* truncate-reveal: exempt -- a search result row; the full title is one tap away */}
                          <span className="block truncate">{r.title}</span>
                          {/* truncate-reveal: exempt -- secondary line of a search result */}
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
          // MORE: the modules without a tab, as big tiles.
          <ul className="grid grid-cols-3 gap-2.5">
            {moreModules.map((m) => {
              const here = m.href === activeModule?.href;
              return (
                <li key={m.href}>
                  {/* button-shape: exempt -- a grid of module tiles in the bottom sheet, navigation rather than a word toggle row */}
                  <button
                    type="button"
                    onClick={() => {
                      const screens = screensOf(m, childrenFor);
                      if (screens.length <= 1) {
                        if (!confirmDiscard()) return;
                        sheetBack.go(screens[0]?.href ?? m.href);
                        return;
                      }
                      setSheet({ more: true, module: m.href });
                    }}
                    className={cn(
                      "flex h-full min-h-[88px] w-full flex-col items-center justify-center gap-2 rounded-2xl border px-1 py-3 text-center [-webkit-tap-highlight-color:transparent] active:scale-[0.97]",
                      here ? "border-primary/40 bg-primary-soft text-primary" : "border-border bg-surface text-foreground",
                    )}
                  >
                    <span className="grid size-11 place-items-center rounded-[13px] bg-primary-soft text-primary">
                      <m.icon className="h-5 w-5" />
                    </span>
                    {/* truncate-reveal: exempt -- module names, two lines allowed */}
                    <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{m.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </BottomSheet>
    </>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/** A dense list row: 44px, the minimum comfortable touch target. */
const ROW =
  "flex min-h-11 w-full items-center gap-3 bg-surface px-3 py-2 text-left text-sm font-medium text-foreground [-webkit-tap-highlight-color:transparent] active:bg-surface-muted";

/** Shared tab chrome. Indicator = a tinted pill behind the icon (Material 3)
 *  plus a coloured, heavier label (iOS) — two signals, so the active tab reads
 *  in either convention and without relying on colour alone. */
function TabInner({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active: boolean }) {
  return (
    <>
      <span
        className={cn(
          // A ROUNDED SQUARE, not a pill (user 2026-11-04, circled on the reference
          // app's Home tab): taller, so it reads as a tile you are standing on.
          "flex h-8 w-12 items-center justify-center rounded-xl transition-colors",
          active && "bg-primary-soft ring-1 ring-inset ring-primary/20",
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
