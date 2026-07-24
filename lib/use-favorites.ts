"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Pinned-module favorites (checklist "Favorites & Recent Items"), stored in
 * localStorage by href. Surfaced in the search palette's default view so the
 * user's most-used modules are one keystroke away. `reloadKey` lets a host
 * re-read storage when it becomes visible (e.g. pass the palette's `isOpen`).
 */
const KEY = "raagam:favorites";

export function useFavorites(reloadKey?: unknown) {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      setFavorites(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setFavorites([]);
    }
  }, [reloadKey]);

  const toggle = useCallback((href: string) => {
    setFavorites((prev) => {
      const next = prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href];
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const isFavorite = useCallback((href: string) => favorites.includes(href), [favorites]);

  return { favorites, toggle, isFavorite };
}
