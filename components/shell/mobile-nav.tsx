"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Plus,
  Search,
  X,
  ChevronRight,
  LayoutGrid,
  Building2,
  Truck,
  Users,
  Package,
  ClipboardList,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { NAV, SECTION_ACTIONS, type NavItem, type SubNavItem } from "./nav";
import { actionIcon, createHref, searchNav, type NavSearchRow } from "./nav-search";
import { type StoreNavLink } from "./sidebar";
import { mastersFabSections } from "@/lib/masters/masters-nav";
import { moduleLeafItems, owningNavHref } from "@/lib/nav/module-groups";
import { useOverlayFocus } from "@/lib/use-overlay-focus";
import { confirmDiscard, useModalGuard } from "@/lib/reload-guard";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import type { SearchEntity, SearchResult } from "@/lib/search/types";
import { cn } from "@/lib/utils";

/**
 * MOBILE BOTTOM TAB BAR (below `md`; the sidebar owns ≥md and is untouched).
 *
 *   Home · Orders · New · Approvals · Menu
 *
 * Replaced the floating "Peek Sheet" pill + separate ＋ FAB (user, 2026-09-24:
 * "bottom navigation with 4–5 primary items … feel native on iOS and
 * Android"). The pill's job — saying where you are — moved to the Menu tab,
 * which takes the current module's glyph and name whenever that module has no
 * tab of its own; the FAB's job moved to the New tab. Nothing floats any more,
 * so the bug-reporter button and the toast stack have one fixed edge to clear.
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

/** Modules with a tab of their own, in bar order around the New tab. */
const PINNED_LEFT = ["/", "/orders"] as const;
const PINNED_RIGHT = ["/approvals"] as const;
const PINNED: readonly string[] = [...PINNED_LEFT, ...PINNED_RIGHT];
/** A pinned module's bar label when it differs from its sidebar label. */
const TAB_LABEL: Record<string, string> = { "/": "Home" };

const MEMORY_KEY = "raagam.mobile-tab-memory";

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

type Sheet = "menu" | "create" | null;

export function MobileNav({ stores = [] }: { stores?: StoreNavLink[] }) {
  // EVERY hook sits above the single early return below (AGENTS.md, "Hooks
  // above every early return").
  const pathname = usePathname();
  const router = useRouter();
  const user = useAppUser();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [query, setQuery] = useState("");
  const [viewHref, setViewHref] = useState<string | null>(null);
  const [records, setRecords] = useState<SearchResult[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  const modules = useMemo(
    () => NAV.filter((i) => hasPermission(user, i.module, "view")),
    [user],
  );

  const dismiss = () => setSheet(null);
  const menuBack = useBackDismiss(sheet === "menu", dismiss);
  const createBack = useBackDismiss(sheet === "create", dismiss);
  const closeSheet = () => (sheet === "menu" ? menuBack : createBack).close();

  useOverlayFocus(sheet === "menu", closeSheet, menuRef);
  useOverlayFocus(sheet === "create", closeSheet, createRef);
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

  if (modules.length === 0) return null;

  const storeLinks: SubNavItem[] = stores.map((s) => ({ href: `/stores/${s.id}`, label: s.name }));
  const childrenFor = (moduleHref: string, children?: SubNavItem[]) =>
    moduleHref === "/stores" ? [...storeLinks, ...(children ?? [])] : (children ?? []);

  const activeModule = moduleOf(pathname, modules);
  const pinnedTabs = PINNED.map((href) => modules.find((m) => m.href === href)).filter(
    (m): m is NavItem => !!m,
  );
  const leftTabs = pinnedTabs.filter((m) => (PINNED_LEFT as readonly string[]).includes(m.href));
  const rightTabs = pinnedTabs.filter((m) => (PINNED_RIGHT as readonly string[]).includes(m.href));
  const inPinned = !!activeModule && PINNED.includes(activeModule.href);
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

  // ── Create actions for the current module ────────────────────────────────
  // Only DECLARED actions. `SECTION_ACTIONS`' own contract is "a section with
  // no entry simply shows no create affordance"; the old FAB instead invented
  // `New ${singular}` for every row, which produced "New Order Entry" on a hub
  // and "New Stock Ledger" on a report — buttons that opened nothing.
  const createGroups = (() => {
    if (!activeModule) return [];
    const candidates: { href: string; label: string }[] =
      activeModule.href === "/masters"
        ? mastersFabSections(pathname)
        : [
            { href: activeModule.href, label: activeModule.label },
            ...moduleLeafItems(activeModule.href),
            ...(activeModule.children ?? []),
          ];
    const seen = new Set<string>();
    const groups = candidates
      .filter((c) => SECTION_ACTIONS[c.href] && !seen.has(c.href) && seen.add(c.href))
      .map((c) => ({ ...c, actions: SECTION_ACTIONS[c.href], here: onRoute(pathname, c.href) }));
    // The screen you are on first — the deepest match, so /orders/all beats /orders.
    const here = groups
      .filter((g) => g.here)
      .sort((a, b) => b.href.length - a.href.length)[0];
    return here ? [here, ...groups.filter((g) => g !== here).map((g) => ({ ...g, here: false }))] : groups;
  })();

  // ── Menu sheet ───────────────────────────────────────────────────────────
  const viewModule = modules.find((m) => m.href === viewHref) ?? activeModule ?? modules[0];
  const viewSections = childrenFor(viewModule.href, viewModule.children);
  const viewActive =
    viewModule.href === activeModule?.href ? activeSectionHref(viewModule, viewSections) : undefined;

  const q = query.trim();
  const results: NavSearchRow[] = q
    ? [
        ...searchNav(query, modules, childrenFor),
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
    setSheet(next);
  }

  function onTab(e: MouseEvent<HTMLAnchorElement>, mod: NavItem) {
    if (!isPlainClick(e)) return; // long-press / new tab keeps the plain href
    e.preventDefault();
    if (!confirmDiscard()) return;
    rememberHere(modules); // capture this screen's latest filters before leaving
    const target = tabTarget(mod.href, activeModule?.href, readMemory());
    if (target !== pathname + window.location.search) router.push(target);
  }

  /** A link inside a sheet: replace the sheet's history entry, see `useBackDismiss`. */
  function sheetLink(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    if (!confirmDiscard()) return;
    (sheet === "menu" ? menuBack : createBack).go(href);
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
          {leftTabs.map((m) => (
            <TabLink
              key={m.href}
              href={m.href}
              icon={m.icon}
              label={TAB_LABEL[m.href] ?? m.label}
              active={sheet === null && activeModule?.href === m.href}
              onClick={(e) => onTab(e, m)}
            />
          ))}
          <TabButton
            icon={Plus}
            label="New"
            active={sheet === "create"}
            disabled={createGroups.length === 0}
            onClick={() => openSheet("create")}
            ariaLabel={
              createGroups.length === 0
                ? "New — nothing to create on this screen"
                : `New — create in ${activeModule?.label}`
            }
          />
          {rightTabs.map((m) => (
            <TabLink
              key={m.href}
              href={m.href}
              icon={m.icon}
              label={TAB_LABEL[m.href] ?? m.label}
              active={sheet === null && activeModule?.href === m.href}
              onClick={(e) => onTab(e, m)}
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

      {/* Scrim, shared by both sheets. */}
      <div
        aria-hidden
        onClick={closeSheet}
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 md:hidden",
          sheet ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* ── Create sheet ───────────────────────────────────────────────── */}
      <BottomSheet
        panelRef={createRef}
        open={sheet === "create"}
        label={`Create in ${activeModule?.label ?? ""}`}
        header={
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">New</div>
              <div className="truncate text-xs text-muted-foreground">{activeModule?.label}</div>
            </div>
            <CloseButton onClick={closeSheet} />
          </div>
        }
      >
        {createGroups.map((g) => (
          <section key={g.href} className="mb-3 last:mb-0">
            <SectionLabel>
              {g.label}
              {g.here && (
                <span className="ml-1.5 rounded bg-primary-soft px-1 py-px text-[10px] font-semibold normal-case tracking-normal text-primary">
                  This screen
                </span>
              )}
            </SectionLabel>
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
              {g.actions.map((a) => {
                const Icon = actionIcon(a);
                const href = createHref(g.href, a);
                return (
                  <li key={a}>
                    <Link href={href} onClick={(e) => sheetLink(e, href)} className={ROW}>
                      <Icon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{a}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </BottomSheet>

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
              })}
            </ul>

            <SectionLabel className="mt-4">Modules</SectionLabel>
            <div className="grid grid-cols-4 gap-1">
              {modules.map((m) => {
                const on = m.href === viewModule.href;
                const here = m.href === activeModule?.href;
                return (
                  <button
                    key={m.href}
                    type="button"
                    onClick={() => setViewHref(m.href)}
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
