"use client";

/**
 * Open-tabs registry for the workspace tab bar
 * (components/shell/workspace-tabs-bar.tsx).
 *
 * Module store, not React context — same reasoning as lib/editor-presence.ts:
 * the bar mounts in the root layout, a server-component boundary away from
 * any screen that wants to register a tab, so a provider would have to be
 * threaded across that boundary for no benefit. Anyone can import this.
 *
 * SWITCHING OR CLOSING A TAB NAVIGATES (`router.push`). This is a
 * quick-switch strip over ordinary Next.js routing — it does NOT keep
 * multiple screens mounted at once, so it does not, by itself, solve "don't
 * lose my in-progress edit when I check a Master". A screen's state survives
 * a switch only if the screen already persists it independently
 * (`useFormDraft`, or its own draft/guard). That's a per-screen decision, not
 * something this store can make for it.
 *
 * V1 SIMPLIFICATION, WORTH RECONSIDERING: `WorkspaceTabsBar` auto-registers
 * whatever route is currently mounted, so the bar has something to show
 * immediately, without any screen having wired in yet. The tradeoff is that
 * plain browsing (not just deliberate "open in a tab" actions) grows the tab
 * list. If that reads as clutter once real screens are wired in, the fix is
 * to stop calling `useRegisterWorkspaceTab` from the bar itself and only ever
 * add a tab via `useOpenWorkspaceTab()`.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { isHubRoute } from "@/lib/nav/module-groups";

export interface WorkspaceTab {
  id: string;
  href: string;
  title: string;
  /** Key into an icon map owned by the bar component — not a ReactNode, so
   *  the tab list stays JSON-serialisable for sessionStorage. Unused by the
   *  bar today; carried so a screen can start passing one without a second
   *  data-shape change later. */
  icon?: string;
  dirty?: boolean;
  /** WHERE IN THE SCREEN THE OPERATOR LEFT OFF, as a query string (`?open=<id>`).
   *  The tab is keyed by pathname, but a screen's editor is usually local state, so
   *  switching back to the tab used to land on the LIST. A screen that can reopen its
   *  record from a URL (`useOpenIntent`) reports it with `useTabResume`, and
   *  `activate` pushes `href + resume`. Absent = the plain screen. */
  resume?: string;
  /** THE SCREEN'S OWN QUERY STRING as last seen (`?status=draft`, a filter, a tab),
   *  tracked by the bar for EVERY tab so leaving and returning lands where the
   *  operator was whenever that place is in the URL. One-shot intents (`new`,
   *  `open`, `costFor`, `draft`) are never stored: replaying them would open a
   *  blank form or re-run an action. `resume` wins over it when both exist. */
  search?: string;
  /** When this tab was last the active one (ms). Lets a MODULE row in the sidebar
   *  find the screen the operator was last on inside that module. */
  seenAt?: number;
}

interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  activeId: string | null;
}

const STORAGE_KEY = "raagam.workspaceTabs.v1";
const EMPTY_STATE: WorkspaceTabsState = { tabs: [], activeId: null };

function readStorage(): WorkspaceTabsState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as WorkspaceTabsState;
    if (!Array.isArray(parsed.tabs)) return EMPTY_STATE;
    // One-time cleanup for a tab list saved before hub routes (a module root,
    // a group's own hub page — see `isHubRoute`) stopped being tab-worthy.
    // Without this, a "Order Management" tab opened in an earlier session
    // keeps showing up forever — closing it by hand is the only way out, and
    // nothing here does that automatically otherwise.
    const tabs = parsed.tabs.filter((t) => !isHubRoute(t.href));
    if (tabs.length === parsed.tabs.length) return parsed;
    const activeId = tabs.some((t) => t.id === parsed.activeId)
      ? parsed.activeId
      : (tabs[tabs.length - 1]?.id ?? null);
    return { tabs, activeId };
  } catch {
    return EMPTY_STATE;
  }
}

let state: WorkspaceTabsState = readStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private/locked-down storage can throw — the strip still works for this
    // session, it just won't survive a reload.
  }
}

function setState(next: WorkspaceTabsState): void {
  // Stamp the tab that is active NOW, so "the last screen in this module" is a
  // fact the store holds, not something a click has to guess.
  if (next.activeId) {
    const now = Date.now();
    next = {
      ...next,
      tabs: next.tabs.map((t) => (t.id === next.activeId && (t.seenAt ?? 0) + 1000 < now ? { ...t, seenAt: now } : t)),
    };
  }
  state = next;
  persist();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): WorkspaceTabsState {
  return state;
}

function getServerSnapshot(): WorkspaceTabsState {
  return EMPTY_STATE;
}

function findByHref(href: string): WorkspaceTab | undefined {
  return state.tabs.find((t) => t.href === href);
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Register a tab for `href` if one isn't already open; make it active
 * either way, and refresh its title/icon if a caller now has a better one.
 * Pure — never navigates.
 */
function registerTab(opts: { href: string; title: string; icon?: string }): WorkspaceTab {
  const existing = findByHref(opts.href);
  if (existing) {
    const needsUpdate =
      state.activeId !== existing.id ||
      existing.title !== opts.title ||
      (opts.icon && existing.icon !== opts.icon);
    if (needsUpdate) {
      setState({
        ...state,
        activeId: existing.id,
        tabs: state.tabs.map((t) =>
          t.id === existing.id ? { ...t, title: opts.title, icon: opts.icon ?? t.icon } : t,
        ),
      });
    }
    return existing;
  }
  const tab: WorkspaceTab = { id: newId(), href: opts.href, title: opts.title, icon: opts.icon };
  setState({ tabs: [...state.tabs, tab], activeId: tab.id });
  return tab;
}

function setTabDirty(id: string, dirty: boolean): void {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || !!tab.dirty === dirty) return;
  setState({ ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) });
}

function setTabResume(href: string, resume: string | null): void {
  const tab = findByHref(href);
  if (!tab || (tab.resume ?? null) === resume) return;
  setState({
    ...state,
    tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, resume: resume ?? undefined } : t)),
  });
}

const ONE_SHOT = ["new", "open", "costFor", "draft"];

function setTabSearch(href: string, query: string): void {
  const tab = findByHref(href);
  if (!tab) return;
  const p = new URLSearchParams(query);
  for (const k of ONE_SHOT) p.delete(k);
  const qs = p.toString();
  const next = qs ? `?${qs}` : undefined;
  if (tab.search === next) return;
  setState({ ...state, tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, search: next } : t)) });
}

function removeTab(id: string): { nextActiveHref: string | null } {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return { nextActiveHref: null };
  const wasActive = state.activeId === id;
  const nextTabs = state.tabs.filter((t) => t.id !== id);
  const fallback = wasActive ? nextTabs[Math.max(0, idx - 1)] : undefined;
  const nextActiveId = wasActive ? (fallback?.id ?? null) : state.activeId;
  setState({ tabs: nextTabs, activeId: nextActiveId });
  return { nextActiveHref: wasActive ? (fallback?.href ?? null) : null };
}

/** Keep one tab, drop the rest. The kept tab is already wherever the operator
 *  is looking at, so this never navigates. */
function pruneToOne(keepId: string): void {
  const keep = state.tabs.find((t) => t.id === keepId);
  if (!keep) return;
  setState({ tabs: [keep], activeId: keep.id });
}

/**
 * Fold tabs that open the SAME screen into one. Two hrefs can be one screen
 * for a given user: a regular staff member's `/hr/staff` redirects to their
 * own `/hr/staff/<id>`, so a tab for each read "My Profile · My Profile" side
 * by side (user 2026-10-03, screenshot 3231). `canonical` says where an href
 * really lands; the tab already AT that href is kept (else the first), moved
 * onto the canonical href, and the rest are dropped. Pure — never navigates.
 */
function mergeSameScreen(canonical: (href: string) => string): void {
  const keepFor = new Map<string, WorkspaceTab>();
  for (const t of state.tabs) {
    const c = canonical(t.href);
    const held = keepFor.get(c);
    if (!held || (held.href !== c && t.href === c)) keepFor.set(c, t);
  }
  const kept = new Set([...keepFor.values()].map((t) => t.id));
  const changed =
    kept.size !== state.tabs.length || state.tabs.some((t) => canonical(t.href) !== t.href);
  if (!changed) return;
  const byId = new Map(state.tabs.map((t) => [t.id, canonical(t.href)]));
  const active = state.tabs.find((t) => t.id === state.activeId);
  const activeId = active ? (keepFor.get(canonical(active.href))?.id ?? null) : state.activeId;
  setState({
    tabs: state.tabs.filter((t) => kept.has(t.id)).map((t) => ({ ...t, href: byId.get(t.id)! })),
    activeId,
  });
}

function clearAll(): void {
  setState(EMPTY_STATE);
}

/**
 * The bar's own hook: read the open tabs and act on them.
 */
export function useWorkspaceTabs() {
  const router = useRouter();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    tabs: snapshot.tabs,
    activeId: snapshot.activeId,
    activate(id: string) {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return;
      setState({ ...state, activeId: id });
      router.push(tab.href + (tab.resume ?? tab.search ?? ""));
    },
    close(id: string) {
      const { nextActiveHref } = removeTab(id);
      if (nextActiveHref) router.push(nextActiveHref);
    },
    /** Overflow menu's "Close others" — keeps `id` (normally the active tab)
     *  open and drops every other tab. */
    closeOthers(id: string) {
      pruneToOne(id);
    },
    /** Overflow menu's "Close all" — nothing is left open, so this is the one
     *  action here that always sends the operator back to Home. */
    closeAll() {
      clearAll();
      router.push("/");
    },
    /** See `mergeSameScreen`. */
    mergeSameScreen,
  };
}

/**
 * Called by a screen to appear in the workspace tab bar while it's mounted,
 * and to keep the bar's active tab pointed at it. `href` should be the
 * screen's own pathname (`usePathname()`) so returning to an already-open
 * route re-focuses the existing tab instead of stacking a duplicate.
 *
 * Pass `dirty` from the screen's own unsaved-changes state (the same value
 * fed to `useUnsavedGuard`) so the tab shows the same dot the reload guard
 * already tracks — two views onto one flag, not a second one to keep in sync
 * by hand.
 */
export function useRegisterWorkspaceTab(opts: {
  href: string;
  title: string;
  icon?: string;
  dirty?: boolean;
}): void {
  const { href, title, icon, dirty } = opts;

  useEffect(() => {
    registerTab({ href, title, icon });
  }, [href, title, icon]);

  useEffect(() => {
    const tab = findByHref(href);
    if (tab) setTabDirty(tab.id, !!dirty);
  }, [href, dirty]);
}

/**
 * A MODULE ROW OPENS WHERE THE OPERATOR LEFT IT (user 2026-10-09: leaving Order
 * Entry from page 1 and coming back through the navigation should show page 1,
 * not the module's default page). Finds the most recently active tab under the
 * module's route and goes to it, resume and query string included; with none,
 * it is the plain `openTab` it always was. Clicking the module you are ALREADY
 * in keeps the old behaviour (its landing page) — `inside` says so.
 */
export function useOpenModule() {
  const router = useRouter();
  const openTab = useOpenWorkspaceTab();
  return (opts: { href: string; title: string; icon?: string; inside: boolean }) => {
    if (!opts.inside && opts.href !== "/") {
      const prefix = opts.href.endsWith("/") ? opts.href : `${opts.href}/`;
      const last = state.tabs
        .filter((t) => t.href.startsWith(prefix))
        .sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0))[0];
      if (last) {
        setState({ ...state, activeId: last.id });
        router.push(last.href + (last.resume ?? last.search ?? ""));
        return;
      }
    }
    openTab(opts);
  };
}

/** The bar's own: keep the active tab's query string current. */
export function useTrackTabSearch(href: string, query: string): void {
  useEffect(() => {
    setTabSearch(href, query);
  }, [href, query]);
}

/**
 * Tell the tab bar where in this screen the operator is, so coming back to the
 * tab through the top navigation lands THERE and not on the screen's list
 * (user 2026-10-09: leaving Order Entry from record no. 1 and returning should
 * reopen record no. 1). `resume` is a query string the screen already answers on
 * load (`?open=<id>`), or `null` while it is on its list. Deliberately does NOT
 * clear on unmount: the whole point is that it outlives the screen.
 */
export function useTabResume(href: string, resume: string | null): void {
  useEffect(() => {
    setTabResume(href, resume);
  }, [href, resume]);
}

/**
 * Ensure the current route has SOME tab, without overwriting a better title
 * a caller may already have set (a sidebar `useOpenWorkspaceTab` click, or a
 * screen's own `useRegisterWorkspaceTab`). This is `WorkspaceTabsBar`'s own
 * fallback — the bug it exists to prevent: the bar re-derives a generic
 * title from the pathname on every route change, and without this guard
 * that generic guess ("Setup") clobbered the sidebar's real label ("Order
 * Management") moments after the click set it correctly, because the bar's
 * effect fires again after the navigation completes.
 *
 * Never call this from a screen — a screen that wants to assert its own
 * title uses `useRegisterWorkspaceTab`, which DOES refresh the title, on
 * purpose: it is the authoritative caller for that route.
 *
 * `skip` is for a route the bar has decided is not tab-worthy (a hub page —
 * see `isHubRoute` in lib/nav/module-groups.ts) — it leaves the store
 * completely alone, rather than registering a tab and hiding it in the UI,
 * so drilling through Orders → Order Management → Order Entry ends with
 * exactly one tab (Order Entry), not three.
 */
export function useEnsureWorkspaceTab(opts: { href: string; title: string; skip?: boolean }): void {
  const { href, title, skip } = opts;

  useEffect(() => {
    if (skip) return;
    const existing = findByHref(href);
    if (existing) {
      if (state.activeId !== existing.id) setState({ ...state, activeId: existing.id });
      return;
    }
    const tab: WorkspaceTab = { id: newId(), href, title };
    setState({ tabs: [...state.tabs, tab], activeId: tab.id });
  }, [href, title, skip]);
}

/**
 * Open (or focus) a tab from OUTSIDE the screen it points to — a sidebar
 * link, a "+" launcher, a picker's "open in workspace" action. Unlike
 * `useRegisterWorkspaceTab`, this also navigates there.
 *
 * THIS IS WHERE A MODULE/SUB-MODULE TAB ACTUALLY CAME FROM. The two-level
 * sidebar (`GlobalSidebar`, `ContextSidebar`) calls this for every row,
 * including a group's own hub row ("Order Management") — and until this
 * check existed it registered a tab for that hub exactly like it would for a
 * real screen. `useEnsureWorkspaceTab`'s `skip` only ever covered the bar's
 * OWN fallback registration; a sidebar click went through this function
 * instead and skipped that guard entirely. So a hub route here just
 * navigates — no tab, same as standing on it directly.
 */
export function useOpenWorkspaceTab() {
  const router = useRouter();
  return (opts: { href: string; title: string; icon?: string }) => {
    if (opts.href !== "/" && isHubRoute(opts.href)) {
      router.push(opts.href);
      return;
    }
    // A SCREEN THE OPERATOR ALREADY HAS OPEN COMES BACK AS THEY LEFT IT (user 2026-10-09:
    // "take them back to the exact screen they were on when they last exited"): the
    // sidebar row for Order Entry used to push the bare route, i.e. its list, even
    // though the tab remembered order no. 1. A link that carries its own query
    // (`?new=1`) is an explicit request and is left alone.
    const kept = opts.href.includes("?") ? undefined : findByHref(opts.href);
    registerTab(opts);
    router.push(opts.href + (kept?.resume ?? kept?.search ?? ""));
  };
}
