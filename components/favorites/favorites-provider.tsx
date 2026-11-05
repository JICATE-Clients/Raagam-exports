"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { importBrowserPins, setScreenFavorite } from "@/lib/favorites/actions";
import { isPinnablePath, resolveFavorite, screenKey } from "@/lib/favorites/registry";

/**
 * Which tiles are on this person's Home — for the ☆ in the top bar and the search palette's
 * pin, which both need "is this screen pinned?" without a round trip (0812).
 *
 * Seeded by the app layout from `getMyShownKeys`, then kept optimistic: a pin changes the set
 * at once and `router.refresh()` brings Home into line. The server is the record — the set is
 * re-seeded whenever the layout renders again.
 */

type FavoritesApi = {
  /** Keys on show (not hidden), as stored: `a:…` or `screen:/…`. */
  shown: ReadonlySet<string>;
  isPinnedPath: (pathname: string) => boolean;
  canPinPath: (pathname: string) => boolean;
  /** Pin or unpin a screen; resolves to whether it is now pinned. */
  toggleScreen: (pathname: string) => Promise<boolean>;
  pending: boolean;
};

const Ctx = createContext<FavoritesApi | null>(null);

/** The search palette's old browser-only pin list (lib/use-favorites.ts before 0812). */
const LEGACY_KEY = "raagam:favorites";

export function FavoritesProvider({ initial, children }: { initial: string[]; children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [shown, setShown] = useState<Set<string>>(() => new Set(initial));
  const [pending, start] = useTransition();

  // Re-seed when the server sends a newer answer (a refresh after any save).
  const initialSig = initial.join("|");
  const [seenSig, setSeenSig] = useState(initialSig);
  if (seenSig !== initialSig) {
    setSeenSig(initialSig);
    setShown(new Set(initial));
  }

  /* ONE-TIME MOVE of the browser's pins into the person's own rows. They followed the
     MACHINE: on a shared PC the next operator inherited them. Cleared only after the save
     succeeds, so a failed move is retried on the next load rather than lost. */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(LEGACY_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let hrefs: unknown;
    try {
      hrefs = JSON.parse(raw);
    } catch {
      hrefs = [];
    }
    const list = Array.isArray(hrefs) ? hrefs.filter((h): h is string => typeof h === "string") : [];
    void importBrowserPins(list).then((res) => {
      if (!res.ok) return;
      try {
        window.localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* storage unavailable — nothing left to clear */
      }
      if (list.length) router.refresh();
    });
  }, [router]);

  const isPinnedPath = useCallback((p: string) => shown.has(screenKey(p)), [shown]);
  const canPinPath = useCallback((p: string) => isPinnablePath(p), []);

  const toggleScreen = useCallback(
    (pathname: string) =>
      new Promise<boolean>((resolve) => {
        const key = screenKey(pathname);
        const on = !shown.has(key);
        const label = resolveFavorite(key)?.label ?? "This screen";
        setShown((prev) => {
          const next = new Set(prev);
          if (on) next.add(key);
          else next.delete(key);
          return next;
        });
        start(async () => {
          const res = await setScreenFavorite(pathname, on);
          if (!res.ok) {
            // Put it back: the star must never claim a pin the server refused.
            setShown((prev) => {
              const next = new Set(prev);
              if (on) next.delete(key);
              else next.add(key);
              return next;
            });
            toast.error(res.error);
            resolve(!on);
            return;
          }
          toast.success(on ? `${label} pinned to Home.` : `${label} removed from Home.`);
          router.refresh();
          resolve(on);
        });
      }),
    [shown, router, toast],
  );

  const api = useMemo<FavoritesApi>(
    () => ({ shown, isPinnedPath, canPinPath, toggleScreen, pending }),
    [shown, isPinnedPath, canPinPath, toggleScreen, pending],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Null outside the app shell (login, print routes) — callers render nothing then. */
export function useFavoritesApi(): FavoritesApi | null {
  return useContext(Ctx);
}
