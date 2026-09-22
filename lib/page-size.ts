"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Rows per page — ONE preference for every list in the app (user, 2026-09-22:
 * "add global pagination option for our application").
 *
 * Before this file each list that paginated held its page size in its own
 * `useState(10)`: pick 50 on Customers, open Vendors, and you were back on 10.
 * Eighteen lists carried that state and ~190 `DataTable` listings carried none
 * and printed every row. Now the value is read from ONE localStorage key by
 * every `usePagination` call, so the "Rows" picker under any list, and the
 * "Rows per page" section of the topbar "T" menu, are the same control — pick
 * once, every list follows.
 *
 * SAME SHAPE AS THE OTHER PREFERENCES (`lib/theme.ts`, `lib/type-scale.ts`,
 * `components/shell/appearance-menu.tsx`): an external store over localStorage,
 * read through `useSyncExternalStore`, with a `storage` listener so a second tab
 * of the app keeps step. Unlike those three this one writes no `<html>`
 * attribute and needs no init script — a page size is not a stylesheet, and the
 * one re-slice after hydration (server snapshot → stored value) is invisible on
 * a list of 10 and a single paint on a list of 100.
 *
 * `DEFAULT_PAGE_SIZE` is 10 because that is what every paginated list already
 * showed. Raising it is a one-constant change here, never a per-screen one.
 */

export const PAGE_SIZE_OPTIONS = [10, 30, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_STORAGE_KEY = "raagam-page-size";

export function isPageSize(v: unknown): v is number {
  return typeof v === "number" && (PAGE_SIZE_OPTIONS as readonly number[]).includes(v);
}

const listeners = new Set<() => void>();
/* Where localStorage is unavailable (private window, blocked site data) the
   choice still holds for this tab instead of snapping back on the next render. */
let inTab: number | null = null;

function read(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    if (isPageSize(n)) return n;
  } catch {
    /* fall through to the in-tab value */
  }
  return inTab ?? DEFAULT_PAGE_SIZE;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PAGE_SIZE_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function write(size: number) {
  if (!isPageSize(size)) return;
  inTab = size;
  try {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
  } catch {
    /* preference just won't persist past this tab */
  }
  for (const l of listeners) l();
}

const server = () => DEFAULT_PAGE_SIZE;

/** The app-wide rows-per-page value and its setter. */
export function usePageSize() {
  const value = useSyncExternalStore(subscribe, read, server);
  const set = useCallback((size: number) => write(size), []);
  return [value, set] as const;
}
