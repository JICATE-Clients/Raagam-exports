"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_TYPE_SCALE,
  TYPE_SCALE_ATTR,
  TYPE_SCALE_STORAGE_KEY,
  isTypeScale,
  type TypeScale,
} from "@/lib/type-scale";

/**
 * The type-scale preference, held in localStorage and on <html> — the same
 * external-store shape as `useTheme` (theme-provider.tsx), for the same
 * reasons: the inline script has already applied it before React exists, and
 * mirroring it into useState would be a set-state-in-effect.
 */

const listeners = new Set<() => void>();

function readScale(): TypeScale {
  try {
    const raw = localStorage.getItem(TYPE_SCALE_STORAGE_KEY);
    return isTypeScale(raw) ? raw : DEFAULT_TYPE_SCALE;
  } catch {
    return DEFAULT_TYPE_SCALE;
  }
}

function applyToDocument(scale: TypeScale) {
  if (scale === "compact") {
    document.documentElement.setAttribute(TYPE_SCALE_ATTR, "compact");
  } else {
    document.documentElement.removeAttribute(TYPE_SCALE_ATTR);
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Keeps other tabs of the app in step.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== TYPE_SCALE_STORAGE_KEY) return;
    applyToDocument(readScale());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const serverScale = (): TypeScale => DEFAULT_TYPE_SCALE;

export function useTypeScale() {
  const scale = useSyncExternalStore(subscribe, readScale, serverScale);

  const setScale = useCallback((next: TypeScale) => {
    try {
      localStorage.setItem(TYPE_SCALE_STORAGE_KEY, next);
    } catch {
      /* preference just won't persist */
    }
    applyToDocument(next);
    for (const l of listeners) l();
  }, []);

  return { scale, setScale };
}

// The New look / Classic switch itself is drawn by `AppearanceMenu`
// (appearance-menu.tsx) since 2026-09-17, as the "Look" section of the topbar
// "T" menu; this file keeps only the preference store it reads.
