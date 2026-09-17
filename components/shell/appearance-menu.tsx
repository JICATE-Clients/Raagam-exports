"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";
import { useTypeScale } from "@/components/shell/type-scale-toggle";
import {
  ACCENTS,
  ACCENT_ATTR,
  ACCENT_STORAGE_KEY,
  FONTS,
  FONT_ATTR,
  FONT_STORAGE_KEY,
  isAccentId,
  isFontId,
} from "@/lib/appearance";

/**
 * One preference held in localStorage and on <html> — the same external-store
 * shape as `useTypeScale`: APPEARANCE_INIT_SCRIPT has already applied it
 * before React exists. The default id writes no attribute, so the default look
 * is globals.css and nothing else.
 */
function createPreference(key: string, attr: string, fallback: string, valid: (v: unknown) => boolean) {
  const listeners = new Set<() => void>();

  const read = (): string => {
    try {
      const raw = localStorage.getItem(key);
      return valid(raw) ? (raw as string) : fallback;
    } catch {
      return fallback;
    }
  };

  const apply = (id: string) => {
    if (id === fallback) document.documentElement.removeAttribute(attr);
    else document.documentElement.setAttribute(attr, id);
  };

  const subscribe = (onChange: () => void) => {
    listeners.add(onChange);
    // Keeps other tabs of the app in step.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      apply(read());
      onChange();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onStorage);
    };
  };

  const write = (id: string) => {
    try {
      localStorage.setItem(key, id);
    } catch {
      /* preference just won't persist */
    }
    apply(id);
    for (const l of listeners) l();
  };

  return { read, subscribe, write, server: () => fallback };
}

const fontPref = createPreference(FONT_STORAGE_KEY, FONT_ATTR, FONTS[0].id, isFontId);
const accentPref = createPreference(ACCENT_STORAGE_KEY, ACCENT_ATTR, ACCENTS[0].id, isAccentId);

function usePreference(pref: ReturnType<typeof createPreference>) {
  const value = useSyncExternalStore(pref.subscribe, pref.read, pref.server);
  const set = useCallback((id: string) => pref.write(id), [pref]);
  return [value, set] as const;
}

/**
 * The topbar "T" button (client 2026-09-17: "use it as the theme changer").
 * Three sections in one menu, each an independent choice:
 *
 *   Look    New look / Classic      — sizes and weights (lib/type-scale.ts)
 *   Font    five faces              — each name drawn in its own face
 *   Colour  six hues                — each with a swatch
 *
 * Choosing applies at once, so the screen behind the menu IS the preview, and
 * any font meets any colour. The sun/moon button beside it stays light/dark;
 * every colour has both.
 *
 * Built on `DropdownMenu`, so ↑/↓/Enter/Esc behave as in every other menu. The
 * button stays tinted while New look is on, as the old toggle was.
 */
export function AppearanceMenu() {
  const { scale, setScale } = useTypeScale();
  const [font, setFont] = usePreference(fontPref);
  const [accent, setAccent] = usePreference(accentPref);
  const compact = scale === "compact";

  const items: DropdownItem[] = [
    { label: "New look", section: "Look", checked: compact, onClick: () => setScale("compact") },
    { label: "Classic", section: "Look", checked: !compact, onClick: () => setScale("standard") },
    ...FONTS.map(
      (f): DropdownItem => ({
        label: f.label,
        section: "Font",
        checked: font === f.id,
        labelStyle: { fontFamily: `${f.family}, sans-serif` },
        onClick: () => setFont(f.id),
      }),
    ),
    ...ACCENTS.map(
      (a): DropdownItem => ({
        label: a.label,
        section: "Colour",
        checked: accent === a.id,
        swatch: a.light.primary,
        onClick: () => setAccent(a.id),
      }),
    ),
  ];

  const fontLabel = FONTS.find((f) => f.id === font)?.label ?? FONTS[0].label;
  const accentLabel = ACCENTS.find((a) => a.id === accent)?.label ?? ACCENTS[0].label;
  const summary = `${compact ? "New look" : "Classic"} · ${fontLabel} · ${accentLabel}`;

  return (
    <span title={`Appearance: ${summary}`}>
      <DropdownMenu
        items={items}
        label={`Appearance: ${summary}. Change look, font or colour.`}
        trigger={<Type className="h-4 w-4" />}
        triggerClassName={cn(
          "flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-muted hover:text-foreground",
          compact ? "bg-primary-soft text-primary" : "text-muted-foreground",
        )}
      />
    </span>
  );
}
