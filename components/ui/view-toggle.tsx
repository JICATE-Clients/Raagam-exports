"use client";

import { useCallback, useSyncExternalStore } from "react";
import { LayoutGrid, List } from "lucide-react";
import { ToggleGroup } from "@/components/ui/segmented";

/**
 * CARD VIEW / LIST VIEW (user 2026-10-16). The queues already drew both layouts
 * — `SampleCards` and `BomQueue` show work still to do as cards and finished
 * work as a table — but the TAB chose, and the operator could not. This is the
 * switch: two icon-only words on the app's one pick-one control (`ToggleGroup`,
 * AGENTS.md "One button shape"), each with the app's own tooltip.
 *
 * THE LIT WORD IS THE THEME'S PRIMARY, not a fixed teal. The request named
 * #087F8C; every other lit segment in the app wears the primary button's own
 * markers so it follows the colour presets in the "T" menu, and a second
 * hard-coded accent would be the eighth toggle shape that rule exists to stop.
 *
 * Only the DRAWING changes: rows, search, filters, pagination and row actions
 * are the queue's and are untouched by a switch.
 */
export type ViewMode = "cards" | "list";

export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <ToggleGroup<ViewMode>
      label="View"
      value={value}
      onChange={onChange}
      options={[
        { value: "cards", icon: LayoutGrid, label: <span className="sr-only">Card View</span>, tooltip: "Card View" },
        { value: "list", icon: List, label: <span className="sr-only">List View</span>, tooltip: "List View" },
      ]}
    />
  );
}

/* ONE REMEMBERED CHOICE PER SCREEN, in this browser — the same shape as the
   rows-per-page preference (lib/page-size.ts): localStorage behind
   `useSyncExternalStore`, falling back to the tab's memory where storage is
   blocked. A per-viewer convenience, never shared state. */
const KEY = (screen: string) => `raagam-view:${screen}`;
const listeners = new Set<() => void>();
const inTab = new Map<string, ViewMode>();

function read(screen: string): ViewMode | null {
  try {
    const v = localStorage.getItem(KEY(screen));
    if (v === "cards" || v === "list") return v;
  } catch {
    /* fall through */
  }
  return inTab.get(screen) ?? null;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("raagam-view:")) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function write(screen: string, v: ViewMode) {
  inTab.set(screen, v);
  try {
    localStorage.setItem(KEY(screen), v);
  } catch {
    /* holds for this tab only */
  }
  for (const l of listeners) l();
}

/**
 * The view a queue shows. Until the operator picks one, `fallback` — the TAB's
 * own default, so Pending still opens as cards and Updated as a list exactly as
 * before; once picked, that screen keeps the pick across tabs and visits.
 */
export function useViewMode(screen: string, fallback: ViewMode) {
  const picked = useSyncExternalStore(
    subscribe,
    () => read(screen),
    () => null,
  );
  const set = useCallback((v: ViewMode) => write(screen, v), [screen]);
  return { view: picked ?? fallback, setView: set };
}
