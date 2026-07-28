"use client";

import { useEffect, type ReactNode } from "react";
import { arrowOpensPicker, arrowNavigate, enterAdvance, tabOpensList } from "@/lib/focus";

/**
 * The ONE place field navigation is wired up.
 *
 * The contract itself lives in lib/focus.ts; this just delivers it everywhere.
 * It used to be bound per surface, which meant a screen only had working keys
 * if someone had remembered to wire it — and an inventory found ~195 editable
 * surfaces against 5 bindings. Every "arrow keys don't work here" report was a
 * surface nobody had reached yet, and every NEW screen started broken (client
 * 2026-07-25). One document listener fixes the whole app and makes future
 * screens correct by default.
 *
 *   Tab again on a picker → open its list
 *   ↓/↑ on a picker       → open its list (the older way in; still supported)
 *   ↓/↑ otherwise         → field above / below
 *   ←/→                   → field left / right, once the caret is at the edge
 *   Enter                 → pick the highlighted row, else next field
 *
 * Controls that own a key (an open dropdown, a child grid, a textarea, a native
 * select) consume it first and this stands down — see the bail-out below.
 *
 * Escape is NOT here. It is not field navigation: it belongs to whichever layer
 * is on top, and each already owns it — the pickers and Combobox close their own
 * list, `Sheet` and `MasterFullScreen` close the editor (asking first when there
 * is unsaved work). A global Escape handler would have to guess how to close an
 * arbitrary surface, and would race the ones that already work.
 */

/**
 * What counts as "the form you are in" — the boundary navigation may not cross.
 * `form` covers the overwhelming majority of surfaces, `[role="dialog"]` covers
 * overlays, and `main` is the fallback for fields rendered straight onto a page.
 * `[data-focus-scope]` lets a surface declare its own boundary, and
 * `[data-focus-scope="off"]` opts out of global navigation entirely.
 */
const SCOPE_SELECTOR = '[data-focus-scope], [role="dialog"], form, main';

/** The keys this provider claims. Everything else is left to the browser. */
const NAV_KEYS = new Set([
  "Tab",
  "Enter",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
]);

function scopeOf(el: HTMLElement): HTMLElement | null {
  const scope = el.closest<HTMLElement>(SCOPE_SELECTOR);
  if (!scope || scope.dataset.focusScope === "off") return null;
  return scope;
}

export function KeyboardNavProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!NAV_KEYS.has(e.key)) return;
      // Modified keys belong to the shortcut layer (see shortcuts-provider).
      // Shift is deliberately allowed through: Shift+Tab must still walk
      // backwards, and every handler below declines it.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // THE bail-out. React 19 + Next attach their delegated listeners to
      // `document` — the same node as this listener — so a React-level
      // stopPropagation() can NOT stop us; only preventDefault is visible here.
      // Everything that legitimately owns a key (Combobox, gridKeyNav, the
      // pickers, the search palette, simple-master-screen's Enter-to-save)
      // already calls preventDefault, so honouring this is what keeps them
      // working untouched.
      if (e.defaultPrevented) return;

      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const root = scopeOf(active);
      if (!root) return;

      // Tab first: it is the only handler that claims Tab, and `Sheet`'s focus
      // trap is also listening on `document`. The trap moves focus on EVERY Tab,
      // so if it ran first it would carry the operator off the picker we are
      // about to open. It defers to `defaultPrevented`, which is what this sets.
      if (tabOpensList(e)) return;
      if (arrowOpensPicker(e)) return;
      if (arrowNavigate(e, root)) return;
      enterAdvance(e, root);
    }

    // Bubble phase, so React's handlers run first and can claim the key.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return <>{children}</>;
}
