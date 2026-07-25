"use client";

import { useEffect } from "react";

/**
 * "Is the user in the middle of something?" — the registry the silent PWA
 * updater (`components/pwa/silent-updater.tsx`) consults before it reloads the
 * page out from under them.
 *
 * A new build reloads the tab automatically and with no UI at all, so the only
 * thing standing between a deploy and a half-typed GRN is this file. Two
 * signals feed it:
 *
 *   1. An explicit busy count. Screens and overlays declare themselves busy via
 *      `useModalGuard` / `useUnsavedGuard`. This is the reliable signal — it
 *      catches inline editors and dirty grids that have no dialog at all.
 *   2. A DOM scan for open modals, as belt-and-braces for the ~14 portal
 *      pickers, the search palette and the import dialog, which nobody has to
 *      remember to register.
 *
 * Kept in `lib/` rather than inside `components/ui/sheet.tsx` for the same
 * reason `lib/shortcuts.ts` is: shared primitives register into it without
 * importing anything from `components/pwa/`, so there's no import cycle.
 */

let busyCount = 0;
const listeners = new Set<() => void>();
let scheduled = false;

/**
 * Fire listeners on the next macrotask, coalesced.
 *
 * Deferring is load-bearing, not politeness. When a Sheet closes, the effect
 * cleanup that releases the guard and the re-render that marks its wrapper
 * `inert` (see `sheet.tsx`) land in the same commit — running the listener
 * synchronously would let `hasOpenModalInDom()` see a dialog that is closing but
 * not yet inert, and veto the very reload we were just unblocked for. It also
 * keeps `location.reload()` out of a React commit phase.
 */
function notify() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    // Copy: a listener is allowed to unsubscribe itself while we iterate.
    for (const listener of [...listeners]) listener();
  }, 0);
}

/** Subscribe to busy-count transitions. Returns an unsubscribe fn. */
export function subscribeBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Imperatively claim a block on reloading. Returns the release fn, which is
 * idempotent — calling it twice can't drive the count negative.
 */
export function acquireBusy(): () => void {
  busyCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) notify();
  };
}

/** True while anything has claimed a block. */
export function isBusy(): boolean {
  return busyCount > 0;
}

/**
 * Block the auto-reload while this component is mounted and `dirty` is true.
 *
 * The idiom is `useUnsavedGuard(dirty || isPending)` — a reload landing
 * mid-server-action loses the success toast and leaves the user unsure whether
 * their save committed.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    return acquireBusy();
  }, [dirty]);
}

/**
 * Block the auto-reload while this overlay is open. Same three lines as
 * `useUnsavedGuard` on purpose — separate names so the call site says *why* the
 * reload is blocked, and so the two policies can diverge later without touching
 * a dozen files.
 */
export function useModalGuard(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    return acquireBusy();
  }, [open]);
}

/**
 * Any modal currently open in the document?
 *
 * `Sheet` keeps its dialog mounted when closed, hidden behind an `inert`
 * wrapper, so presence alone isn't enough — skip anything inside an `inert`
 * subtree. Every other overlay in the app (the pickers, search palette, import
 * dialog) mounts its portal only while open, so for those presence does mean
 * open.
 *
 * Note this deliberately cannot see `MasterFullScreen`, which is a bare
 * fixed-inset div with no dialog role. That one calls `useModalGuard` instead.
 */
export function hasOpenModalInDom(): boolean {
  if (typeof document === "undefined") return false;
  const nodes = document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]');
  for (const el of nodes) {
    if (!el.closest("[inert]")) return true;
  }
  return false;
}

/** ms since the last keystroke anywhere in the page; Infinity if none yet. */
let lastKeyAt = 0;

/**
 * Called by the updater's passive keydown listener. Exported so the policy in
 * `isSafeToReload` can consult it without the updater having to thread the
 * timestamp through.
 */
export function markKeyActivity(): void {
  lastKeyAt = Date.now();
}

/** ms since the user last pressed a key. `Infinity` if they haven't yet. */
export function msSinceLastKey(): number {
  return lastKeyAt === 0 ? Infinity : Date.now() - lastKeyAt;
}

/** How long after a keystroke the page still counts as "in use". */
export const TYPING_GRACE_MS = 5_000;

/**
 * The single question the updater asks before reloading the page.
 *
 * Returning false defers the reload — it will be asked again at the next
 * safe-point (a guard released, a route change, the tab hiding or showing, or
 * the 30s catch-all tick), so a `false` here never means "never", only
 * "not yet".
 */
export function isSafeToReload(): boolean {
  // SSR: nothing to reload.
  if (typeof document === "undefined") return false;

  // A deferred reload can fire minutes after the update was detected. If the
  // network died in between, reloading drops the user on /offline for no reason.
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;

  // Someone declared themselves busy: an open overlay, a dirty form, or a
  // save in flight.
  if (isBusy()) return false;

  // Belt-and-braces for overlays that never registered.
  if (hasOpenModalInDom()) return false;

  // Actively typing on a surface nobody registered — the last line of defence
  // against "it reloaded mid-sentence". Only applies to a visible tab; nobody
  // is typing into a hidden one.
  if (document.visibilityState === "visible" && msSinceLastKey() < TYPING_GRACE_MS) return false;

  return true;
}
