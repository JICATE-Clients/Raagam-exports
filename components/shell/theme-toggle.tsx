"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/shell/theme-provider";
import type { Theme } from "@/lib/theme";

const ORDER: Theme[] = ["light", "dark", "system"];

const META: Record<Theme, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
  system: { icon: Monitor, label: "System" },
};

/**
 * Cycles light → dark → system.
 *
 * A three-state cycle rather than a two-state switch because "follow the OS" is
 * a real preference — someone whose phone flips to dark at sunset wants the app
 * to come with it, and a binary toggle silently opts them out the first time
 * they touch it.
 *
 * During hydration `useTheme` returns the server snapshot ("system"), so the
 * icon starts neutral and settles a tick later. That's deliberate: the theme
 * itself is already on <html> from the inline script in app/layout.tsx, so
 * nothing flashes — only this one glyph waits, and in exchange the markup
 * matches on hydration.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const current = theme;
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = META[current].icon;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Theme: ${META[current].label}`}
      aria-label={`Theme: ${META[current].label}. Switch to ${META[next].label}.`}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
