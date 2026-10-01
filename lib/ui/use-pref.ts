"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A remembered per-viewer choice (a view, a toggle), read through
 * `useSyncExternalStore` the way `lib/page-size.ts` reads Rows per page: the
 * server renders the fallback and the browser swaps in the stored value
 * without a set-state-in-effect. A blocked store only loses the memory.
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const v = window.localStorage.getItem(key);
        return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const set = useCallback(
    (v: T) => {
      try {
        window.localStorage.setItem(key, v);
      } catch {
        /* a blocked store only loses the remembered choice */
      }
      for (const l of listeners) l();
    },
    [key],
  );
  return [value, set] as const;
}
