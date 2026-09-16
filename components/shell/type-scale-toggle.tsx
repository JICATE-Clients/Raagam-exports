"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Type } from "lucide-react";
import { cn } from "@/lib/utils";
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

/**
 * On/off switch for NEW LOOK — the compact type scale AND the refined colour
 * system (client 2026-09-16) — beside the colour-theme button in the topbar. A pressed-state toggle rather than a step in ThemeToggle's cycle:
 * text size and colour are separate choices, and folding them into one cycle
 * would force a compact-text user to pick a colour they did not ask for.
 */
export function TypeScaleToggle() {
  const { scale, setScale } = useTypeScale();
  const on = scale === "compact";

  return (
    <button
      type="button"
      onClick={() => setScale(on ? "standard" : "compact")}
      aria-pressed={on}
      title={on ? "New look: on" : "New look: off"}
      aria-label={on ? "New look is on. Switch to the classic look." : "New look is off. Switch to the new look."}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-muted hover:text-foreground",
        on ? "bg-primary-soft text-primary" : "text-muted-foreground",
      )}
    >
      <Type className="h-4 w-4" />
    </button>
  );
}
