"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DARK_QUERY,
  THEME_STORAGE_KEY,
  isTheme,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme";

/**
 * Theme state, held in localStorage and the `<html>` class rather than in React.
 *
 * ## Why an external store instead of useState + useEffect
 *
 * The preference already lives outside React — the inline script in
 * app/layout.tsx has applied it to <html> before React exists, and the OS can
 * change it at any time. Mirroring that into component state means reading it
 * in an effect and calling setState, which is a cascading render and exactly
 * what `react-hooks/set-state-in-effect` objects to.
 *
 * `useSyncExternalStore` is the shape React provides for this: it renders the
 * server snapshot ("system") during hydration so the markup matches, then
 * immediately re-renders with the real client value. That also gives the toggle
 * its "don't render a theme-dependent icon until we know" behaviour for free,
 * with no `mounted` flag.
 *
 * No context and no provider: there is exactly one theme per document, so
 * threading it through a tree would be ceremony around a global.
 */

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function darkMedia(): MediaQueryList | null {
  return typeof window === "undefined" ? null : window.matchMedia(DARK_QUERY);
}

/** Push the effective theme onto <html>. The class is the single source of truth for CSS. */
function applyToDocument(theme: Theme): ResolvedTheme {
  const dark =
    theme === "dark" || (theme === "system" && (darkMedia()?.matches ?? false));
  document.documentElement.classList.toggle("dark", dark);
  return dark ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  // Follow the OS only while the stored preference is "system"; an explicit
  // choice must not be overridden by the machine waking up in dark mode.
  const mq = darkMedia();
  const onMedia = () => {
    if (readTheme() === "system") applyToDocument("system");
    onChange();
  };
  mq?.addEventListener("change", onMedia);

  // Keeps other tabs of the app in step.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    applyToDocument(readTheme());
    onChange();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onChange);
    mq?.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Snapshots must return a primitive. Returning a fresh object here would make
 * every comparison unequal and spin React in an infinite re-render.
 */
function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

function readResolved(): ResolvedTheme {
  const t = readTheme();
  if (t !== "system") return t;
  return darkMedia()?.matches ? "dark" : "light";
}

const serverTheme = (): Theme => "system";
const serverResolved = (): ResolvedTheme => "light";

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const resolved = useSyncExternalStore(subscribe, readResolved, serverResolved);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* preference just won't persist */
    }
    applyToDocument(next);
    notify();
  }, []);

  return { theme, resolved, setTheme };
}

export type { Theme, ResolvedTheme };
