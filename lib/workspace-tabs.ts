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
    return Array.isArray(parsed.tabs) ? parsed : EMPTY_STATE;
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
      router.push(tab.href);
    },
    close(id: string) {
      const { nextActiveHref } = removeTab(id);
      if (nextActiveHref) router.push(nextActiveHref);
    },
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
 */
export function useEnsureWorkspaceTab(opts: { href: string; title: string }): void {
  const { href, title } = opts;

  useEffect(() => {
    const existing = findByHref(href);
    if (existing) {
      if (state.activeId !== existing.id) setState({ ...state, activeId: existing.id });
      return;
    }
    const tab: WorkspaceTab = { id: newId(), href, title };
    setState({ tabs: [...state.tabs, tab], activeId: tab.id });
  }, [href, title]);
}

/**
 * Open (or focus) a tab from OUTSIDE the screen it points to — a sidebar
 * link, a "+" launcher, a picker's "open in workspace" action. Unlike
 * `useRegisterWorkspaceTab`, this also navigates there.
 */
export function useOpenWorkspaceTab() {
  const router = useRouter();
  return (opts: { href: string; title: string; icon?: string }) => {
    registerTab(opts);
    router.push(opts.href);
  };
}
