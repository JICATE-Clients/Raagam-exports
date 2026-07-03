"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { SearchPalette } from "./search-palette";

interface SearchApi {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const SearchContext = createContext<SearchApi | null>(null);

/**
 * Hosts the global "Search Everywhere" palette and its open/close state.
 * Mounted once inside the authenticated shell (below PermissionProvider) so the
 * palette can read the current user's permissions. Also installs the app's
 * first keyboard shortcut: ⌘K / Ctrl+K toggles the palette.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SearchContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
      <SearchPalette isOpen={isOpen} onClose={close} />
    </SearchContext.Provider>
  );
}

export function useSearch(): SearchApi {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within a SearchProvider");
  return ctx;
}
