"use client";

import { createContext, useContext, useEffect, useRef } from "react";

/**
 * Global keyboard-shortcut registry — context + hooks only. The provider UI
 * (window listener + help dialog) lives in
 * `components/shell/shortcuts-provider.tsx`. Kept here so shared primitives
 * (e.g. `Sheet`) can register handlers without importing the provider, which
 * would create a cycle (the provider renders a `Sheet` for its help dialog).
 */

export type ShortcutId = "new" | "save" | "search";
type Handler = () => void;

export interface ShortcutsApi {
  register: (id: ShortcutId, fn: Handler) => () => void;
  openHelp: () => void;
}

export const ShortcutsContext = createContext<ShortcutsApi | null>(null);

/**
 * Register a handler for a global shortcut while the calling component is
 * mounted and `enabled` is true (e.g. an editor registers "save" only while
 * open). No-ops when there's no provider or no handler.
 */
export function useRegisterShortcut(id: ShortcutId, fn: Handler | undefined, enabled = true) {
  const api = useContext(ShortcutsContext);
  const ref = useRef(fn);
  ref.current = fn;
  const active = enabled && !!fn;
  useEffect(() => {
    if (!api || !active) return;
    return api.register(id, () => ref.current?.());
  }, [api, id, active]);
}

export function useShortcuts(): ShortcutsApi | null {
  return useContext(ShortcutsContext);
}
