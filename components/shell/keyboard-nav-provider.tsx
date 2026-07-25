"use client";

import { useEffect, type ReactNode } from "react";
import { arrowOpensPicker, arrowNavigate, enterAdvance } from "@/lib/focus";

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
 *   ↓/↑ on a picker  → open its dialog
 *   ↓/↑ otherwise    → previous / next field
 *   Enter            → next field
 *
 * Controls that own a key (an open dropdown, a child grid, a textarea, a native
 * select) consume it first and this stands down — see the bail-out below.
 */

/**
 * What counts as "the form you are in" — the boundary navigation may not cross.
 * `form` covers the overwhelming majority of surfaces, `[role="dialog"]` covers
 * overlays, and `main` is the fallback for fields rendered straight onto a page.
 * `[data-focus-scope]` lets a surface declare its own boundary, and
 * `[data-focus-scope="off"]` opts out of global navigation entirely.
 */
const SCOPE_SELECTOR = '[data-focus-scope], [role="dialog"], form, main';

function scopeOf(el: HTMLElement): HTMLElement | null {
  const scope = el.closest<HTMLElement>(SCOPE_SELECTOR);
  if (!scope || scope.dataset.focusScope === "off") return null;
  return scope;
}

export function KeyboardNavProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      // Modified keys belong to the shortcut layer (see shortcuts-provider).
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
