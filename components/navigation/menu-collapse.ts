"use client";

import { useSyncExternalStore } from "react";

/**
 * THE MODULE MENU CAN BE FOLDED AWAY (Sarvam sidebar review, user 2026-10-29,
 * fix 4, https://claude.ai/artifact/EgufM8nybBmMcZ3LcvHV4H). The button beside
 * the module's name hides the 224px menu and leaves the icon rail; the rail's
 * own "Show menu" button brings it back. A per-operator preference, so it
 * lives in this browser's localStorage and survives a reload — never in the
 * database, and never per module (folding it on Purchase and finding it open
 * on Orders would read as the app forgetting).
 *
 * `useSyncExternalStore`, not `useState` + an effect: the menu and the rail
 * read the same value, and a second tab folding it updates this one through
 * the `storage` event. The server snapshot is "open", so the first paint
 * always matches what the server rendered.
 */
const KEY = "raagam:module-menu-collapsed";
const listeners = new Set<() => void>();
// Holds the choice when localStorage throws, so the button still does something.
let memory: boolean | null = null;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setMenuCollapsed(collapsed: boolean) {
  try {
    if (collapsed) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the fold still works for this page view.
    memory = collapsed;
  }
  listeners.forEach((l) => l());
}

export function useMenuCollapsed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => memory ?? read(),
    () => false,
  );
}
