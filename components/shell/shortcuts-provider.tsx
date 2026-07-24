"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { ShortcutsContext, type ShortcutId } from "@/lib/shortcuts";

/**
 * Global keyboard-shortcut hub — the second app-wide shortcut layer after the
 * ⌘K search palette (`components/search/search-provider.tsx`). Owns a single
 * `window` keydown listener plus a tiny per-id handler registry so the
 * currently-active editor/list registers its own action:
 *
 *   Ctrl/⌘+N  → create (list registers `onAdd`)
 *   Ctrl/⌘+S  → save the open editor (Sheet / MasterFullScreen register it)
 *   Ctrl/⌘+F  → focus the list search box (MasterListShell registers it)
 *   Ctrl/⌘+/  → toggle this help dialog
 *
 * Registration is a stack per id: the most-recently mounted handler wins, so an
 * open editor's Save takes precedence over anything underneath — mirrors the
 * Sheet's own `sheetStack` pattern. Handlers no-op safely when nothing is
 * registered (e.g. Ctrl+F on a page with no list falls through to the browser).
 */

type Handler = () => void;

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Ctrl / ⌘ + K", label: "Search everywhere" },
  { keys: "Ctrl / ⌘ + N", label: "New record (on a list)" },
  { keys: "Ctrl / ⌘ + S", label: "Save the open form" },
  { keys: "Ctrl / ⌘ + F", label: "Focus the list search box" },
  { keys: "Ctrl / ⌘ + /", label: "Show this shortcuts help" },
  { keys: "Enter", label: "Move to the next field (in a form)" },
  { keys: "Esc", label: "Close the open dialog / picker" },
  { keys: "↑ / ↓ then Enter", label: "Pick a value in a lookup" },
];

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  // Per-id handler stacks (topmost wins). Refs, not state — registration must
  // not re-render the whole app subtree.
  const stacks = useRef<Record<ShortcutId, Handler[]>>({ new: [], save: [], search: [] });
  const [helpOpen, setHelpOpen] = useState(false);

  const register = useCallback((id: ShortcutId, fn: Handler) => {
    stacks.current[id].push(fn);
    return () => {
      const arr = stacks.current[id];
      const i = arr.lastIndexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    };
  }, []);

  const fire = useCallback((id: ShortcutId): boolean => {
    const arr = stacks.current[id];
    const fn = arr[arr.length - 1];
    if (fn) {
      fn();
      return true;
    }
    return false;
  }, []);

  const openHelp = useCallback(() => setHelpOpen(true), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // "/" reports as "/" even with modifiers.
      if (e.key === "/") {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "s") {
        // Only swallow the browser's Save-page when an editor is actually open.
        if (fire("save")) e.preventDefault();
      } else if (k === "n") {
        // Browser may reserve Ctrl+N (new window); we try anyway.
        if (fire("new")) e.preventDefault();
      } else if (k === "f") {
        // Fall through to the browser's Find when no list search is present.
        if (fire("search")) e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fire]);

  return (
    <ShortcutsContext.Provider value={{ register, openHelp }}>
      {children}
      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts" size="sm">
        <ul className="divide-y divide-border">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-foreground">{s.label}</span>
              <kbd className="shrink-0 rounded-md border border-border bg-surface-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </Sheet>
    </ShortcutsContext.Provider>
  );
}
