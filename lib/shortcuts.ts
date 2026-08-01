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
  /**
   * Run the topmost handler for `id`; false when nothing is registered. Exposed
   * because Enter's last step (lib/focus.ts `submitSurface`) has to reach exactly
   * the same handler Ctrl+S does — an editor must not have two different saves.
   */
  fire: (id: ShortcutId) => boolean;
  /**
   * Is anything registered for `id`? A NON-FIRING probe, and that is the whole
   * point: Enter-advance (lib/focus.ts `enterAdvances`) has to ask "could this
   * surface save?" BEFORE it decides whether to claim the key at all, and the
   * only other way to find out was to fire the handler and see — i.e. to save.
   */
  has: (id: ShortcutId) => boolean;
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
