"use client";

import { useCallback, useMemo } from "react";
import { useFavoritesApi } from "@/components/favorites/favorites-provider";
import { SCREEN_PREFIX, screenKey } from "@/lib/favorites/registry";

/**
 * The search palette's pins, now THE SAME LIST AS HOME (0812).
 *
 * This used to keep its own list of hrefs in localStorage (`raagam:favorites`), which followed
 * the machine rather than the person and was seen nowhere but the palette. It now reads the
 * person's Home Favourites, so pinning a module here puts a tile on Home and the ☆ in the top
 * bar agrees. `FavoritesProvider` moves an old browser list across once, on first load.
 *
 * Same shape as before so its one caller did not change; `reloadKey` is accepted and unused —
 * the provider is already live.
 */
export function useFavorites(reloadKey?: unknown) {
  void reloadKey;
  const fav = useFavoritesApi();
  const favorites = useMemo(
    () => (fav ? [...fav.shown].filter((k) => k.startsWith(SCREEN_PREFIX)).map((k) => k.slice(SCREEN_PREFIX.length)) : []),
    [fav],
  );
  const toggle = useCallback((href: string) => void fav?.toggleScreen(href), [fav]);
  const isFavorite = useCallback((href: string) => !!fav?.shown.has(screenKey(href)), [fav]);
  return { favorites, toggle, isFavorite };
}
