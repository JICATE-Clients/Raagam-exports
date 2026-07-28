"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  arrowOpensPicker,
  arrowNavigate,
  enterSaves,
  rememberFocus,
  restoreFocusIfLost,
} from "@/lib/focus";
import { useShortcuts } from "@/lib/shortcuts";
import { confirmDiscard, hasOpenModalInDom } from "@/lib/reload-guard";

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
 *   Tab      → next field. Nothing else, ever — it does not open lists.
 *   ↓        → open this field's list; with no list, the field below
 *   ↑        → the field above
 *   ←/→      → field left / right, once the caret is at the edge
 *   Enter    → pick the highlighted row, else SAVE the record
 *   Esc      → close the list, then the surface, then leave the page
 *
 * Controls that own a key (an open dropdown, a child grid, a textarea, a native
 * select) consume it first and this stands down — see the bail-out below.
 *
 * Tab is deliberately absent from NAV_KEYS. `Sheet` runs its own region-ordered
 * focus trap on Tab inside a dialog, and everywhere else native order is
 * correct; the provider claiming Tab only ever existed to overload it with
 * "open the list", which ↓ now does (client 2026-07-28).
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
const NAV_KEYS = new Set(["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]);

function scopeOf(el: HTMLElement): HTMLElement | null {
  const scope = el.closest<HTMLElement>(SCOPE_SELECTOR);
  if (!scope || scope.dataset.focusScope === "off") return null;
  return scope;
}

export function KeyboardNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Enter saves through the same registry Ctrl+S uses. Held in a ref because the
  // context value is a fresh object each render and the listeners bind once.
  const shortcuts = useShortcuts();
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  });

  /**
   * Remember where the cursor was, so an overlay that unmounts can hand it back.
   * One listener, because the alternative is every portal picker growing its own
   * `openerRef` the way `Sheet` had to. See `rememberFocus` in lib/focus.ts.
   */
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => rememberFocus(e.target);
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!NAV_KEYS.has(e.key)) return;
      // Modified keys belong to the shortcut layer (see shortcuts-provider),
      // except Alt+↓, which is how a child-grid cell opens its list.
      if (e.metaKey || e.ctrlKey) return;
      if (e.altKey && e.key !== "ArrowDown") return;

      // THE bail-out. React 19 + Next attach their delegated listeners to
      // `document` — the same node as this listener — so a React-level
      // stopPropagation() can NOT stop us; only preventDefault is visible here.
      // Everything that legitimately owns a key (Combobox, gridKeyNav, the
      // pickers, the search palette, simple-master-screen's Enter-to-save)
      // already calls preventDefault, so honouring this is what keeps them
      // working untouched.
      if (e.defaultPrevented) return;

      // Last line of defence for the "focus is never stranded" invariant: if
      // something dropped the cursor on <body>, put it back before reading it,
      // so the very next keystroke works instead of being swallowed.
      restoreFocusIfLost();

      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const root = scopeOf(active);
      if (!root) return;

      if (arrowOpensPicker(e)) return;
      if (arrowNavigate(e, root)) return;
      enterSaves(e, root, (id) => shortcutsRef.current?.fire(id) ?? false);
    }

    // Bubble phase, so React's handlers run first and can claim the key.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * ESCAPE, LAST LAYER: leave the page (client 2026-07-28).
   *
   * Escape unwinds exactly one layer per press — an open list, then the
   * surface — and each of those layers already owns the key locally. This is the
   * bottom of the ladder: nothing is open, so the page itself is what the
   * operator is escaping from.
   *
   * It is bound to `window`, not `document`, and that is the whole design. Every
   * other Escape handler in the app — `Sheet`, `MasterFullScreen`, the dialog
   * pickers, `Combobox`, and React's own delegated handlers — sits on
   * `document`, and an event reaches `window` only after `document` has finished
   * with it. So this listener is guaranteed to run LAST and to see their
   * `preventDefault()`, without any ordering hacks. The corollary is a hard rule:
   * anything that consumes Escape MUST call preventDefault, or dismissing it will
   * also navigate the page away.
   */
  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Belt-and-braces for an overlay that forgot to preventDefault.
      if (hasOpenModalInDom()) return;
      // Nothing to go back to (a directly-opened tab): stay put rather than
      // dumping the operator outside the app.
      if (window.history.length <= 1) return;
      if (!confirmDiscard()) return;
      e.preventDefault();
      router.back();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [router]);

  return <>{children}</>;
}
