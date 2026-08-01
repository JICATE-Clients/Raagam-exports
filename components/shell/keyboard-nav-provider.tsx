"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  arrowOpensPicker,
  arrowNavigate,
  atCaretEdge,
  enterAdvances,
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
 *   Tab      → next field. It does not open lists, and it changes nothing.
 *   ↓        → open this field's list; with no list, the field below
 *   ↑        → the field above
 *   ←/→      → field left / right, once the caret is at the edge
 *   Enter    → pick the highlighted row, else the NEXT FIELD; off the last one,
 *              save the record
 *   Esc      → close the list, then the surface, then leave the page
 *
 * Controls that own a key (an open dropdown, a child grid, a textarea, a native
 * select) consume it first and this stands down — see the bail-out below.
 *
 * Tab is deliberately absent from NAV_KEYS. `Sheet` runs its own region-ordered
 * focus trap on Tab inside a dialog, and everywhere else native order is
 * correct; the provider claiming Tab only ever existed to overload it with
 * "open the list", which ↓ now does (client 2026-07-28). It stays absent — the
 * duplicate hold below is a SEPARATE listener on a different node and phase.
 *
 * THE ONE REFUSAL. Every movement key above has exactly one case where it will
 * not move: a field showing a live "already exists" duplicate holds the cursor
 * until the value is edited (client 2026-07-31). It is implemented once, here,
 * and nowhere else — see the hold effect below.
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

/**
 * The keys the duplicate hold refuses. Tab IS here — unlike NAV_KEYS — because
 * the hold is about not leaving the field, and Tab is the main way to leave it.
 */
const HOLD_KEYS = new Set(["Tab", "Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]);

function scopeOf(el: HTMLElement): HTMLElement | null {
  const scope = el.closest<HTMLElement>(SCOPE_SELECTOR);
  if (!scope || scope.dataset.focusScope === "off") return null;
  return scope;
}

export function KeyboardNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Enter's LAST step saves, through the same registry Ctrl+S uses. Held in a ref
  // because the context value is a fresh object each render and the listeners
  // bind once.
  const shortcuts = useShortcuts();
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  });

  /**
   * THE DUPLICATE HOLD — the one place in the app where a movement key
   * deliberately fails to move (client 2026-07-31).
   *
   * While a field shows a live "already exists" error, Tab / Shift+Tab / Enter
   * and the arrows are refused and the cursor stays on it. Editing the value
   * clears the error in the same render as the keystroke (see the `askKey` rule
   * in lib/masters/use-duplicate-check.ts), so movement resumes immediately.
   *
   * WINDOW, CAPTURE PHASE, AND IT STOPS PROPAGATION. `preventDefault` alone is
   * not enough: `gridKeyNav` (components/masters/child-grid.tsx) and the Tab
   * branch of `pickerKeyDown` (components/masters/picker-keys.ts — which is
   * exactly the DataPicker Add form where the duplicate hint lives) never read
   * `defaultPrevented` and would move focus anyway. `window` capture is the
   * FIRST node on the propagation path, not a registration-order race, so
   * stopping there means React never dispatches and no `document` listener
   * runs. Note the symmetry with the Escape ladder at the bottom of this file:
   * window-capture runs first, window-bubble runs last, and `document` is where
   * everything that negotiates with everything else lives.
   *
   * `stopPropagation`, NOT `stopImmediatePropagation` — components/pwa/
   * silent-updater.tsx is another window-capture listener and has no reason to
   * be blinded.
   *
   * AND IT CATCHES UP. The paragraph above is a KEYDOWN-time test — it reads the
   * attribute off the focused field at the instant the key is pressed. A check
   * that answers 300ms later (every server-only `useDuplicateCheck`) is not back
   * yet, so the operator who types and tabs straight away is already gone when
   * the message paints, and the whole rule looks broken from the floor: "the
   * error is showing and the cursor moved anyway" (client 2026-08-01). So a late
   * answer FETCHES THE CURSOR BACK — see the catch-up below. The synchronous
   * half of `useDuplicateName` is still the real fix; this is what makes the
   * rule true even when only the server can know.
   *
   * Scoped as narrowly as it can be:
   *   - keys off `data-dup-error`, NEVER `aria-invalid`. ValidatedInput sets
   *     aria-invalid live for every required-but-empty field, so holding on it
   *     would cage the operator in the first blank box of every form.
   *   - never holds a field they cannot type into (readOnly/disabled). The
   *     Material Name is readOnly for attribute-driven classes; holding there
   *     is a cage with no keyboard way out at all.
   *   - ←/→ still move the CARET; only the edge press is refused.
   *   - Escape, the mouse and every Ctrl/⌘ shortcut stay live. Those are the
   *     three ways out, and DuplicateError names the first of them on screen.
   */
  const liveRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    function heldField(): HTMLElement | null {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return null;
      if (!el.getAttribute("data-dup-error")) return null;
      // A field with nothing to edit cannot clear its own error.
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        (el.readOnly || el.disabled)
      ) {
        return null;
      }
      return el;
    }

    /**
     * A REFUSED KEY MUST NOT BE A DEAD KEY — that is the exact bug class this
     * app has shipped before. Three cheap channels: a 160ms nudge on the field,
     * an assertive announcement, and the message already sitting under it.
     *
     * Deliberately NOT a toast: held Tab presses arrive in bursts and would
     * fill the corner with identical errors.
     */
    function refuse(el: HTMLElement, message: string) {
      // Re-set with a forced reflow between, or a second refusal restarts
      // nothing and the nudge only ever plays once.
      delete el.dataset.dupHeld;
      void el.offsetWidth;
      el.dataset.dupHeld = "";
      // Clear it again when the animation finishes, so the attribute does not
      // outlive the nudge on a node React knows nothing about. Safe under
      // reduced motion: globals.css clamps to 0.01ms rather than 0s precisely
      // so this event still fires.
      el.addEventListener("animationend", () => delete el.dataset.dupHeld, { once: true });

      const live = liveRef.current;
      if (!live) return;
      // Blank first: an identical string written twice is not re-announced.
      live.textContent = "";
      live.textContent = `${message} Edit the value, or press Escape to cancel.`;
    }

    /**
     * THE CATCH-UP — the hold, for an answer that arrived too late.
     *
     * `leftField` is where the cursor was standing when a movement key took it
     * away, and `leftAt` is when. If that field grows a `data-dup-error` within
     * the window, the cursor goes back to it: the check was simply still in
     * flight when the key was pressed, and the operator must not be allowed to
     * walk away from a colliding name just because the network was slow.
     *
     * Recording EVERY departure, not just from duplicate-checked fields, is
     * free — the observer only ever fires for an element that later grows the
     * attribute, and knowing in advance which fields are checked would mean
     * teaching this listener about the masters layer.
     *
     * `forget()` is the whole safety story, and every caller of it below is a
     * case where pulling the cursor back would be WORSE than missing:
     *   - a non-movement key: the operator is already TYPING in the field they
     *     moved to, and stealing focus mid-word misdirects those keystrokes.
     *   - `pointerdown`: leaving by mouse is a deliberate exit, and the mouse is
     *     one of the three ways out this rule promises.
     *   - focus landed in another surface, or the field is gone / read-only /
     *     inert / not rendered — the same stand-downs `heldField` makes.
     * Past the window the operator has moved on and a jump would read as the
     * page misbehaving rather than as an error being pointed at.
     */
    const CATCH_UP_MS = 2000; // the 300ms debounce plus a slow round trip
    let leftField: HTMLElement | null = null;
    let leftAt = 0;
    function forget() {
      leftField = null;
    }

    function catchUp(el: HTMLElement) {
      const message = el.getAttribute("data-dup-error");
      if (!message) return; // the error CLEARED — nothing to point at
      if (Date.now() - leftAt > CATCH_UP_MS || !el.isConnected) return forget();
      const active = document.activeElement;
      if (active === el) return forget(); // never actually left, or already back
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        (el.readOnly || el.disabled)
      ) {
        return forget();
      }
      // A field in a closed Sheet or an unmounted section is not somewhere the
      // cursor may be put. `offsetParent` is the same cheap test `focusablesIn`
      // (lib/focus.ts) uses; `inert` covers the closed-but-rendered Sheet.
      if (!el.offsetParent || el.closest("[inert]")) return forget();
      // Focus is in a different surface — another dialog, a picker portal, the
      // sidebar. Yanking ACROSS surfaces is worse than the miss: the operator
      // is somewhere they chose to be. `body` is not a surface, it is stranded
      // focus, and that is exactly a case worth rescuing.
      const strayed = active instanceof HTMLElement && active !== document.body;
      if (strayed && scopeOf(active) !== scopeOf(el)) return forget();

      forget(); // one shot — a second answer must not yank a second time
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // Caret at the end, nothing selected. Selecting the value would arm the
        // operator's own typing to wipe it, and this is a correction prompt.
        try {
          el.setSelectionRange(el.value.length, el.value.length);
        } catch {
          /* number/email inputs don't support selection ranges */
        }
      }
      refuse(el, message);
    }

    const watcher = new MutationObserver((records) => {
      if (!leftField) return;
      for (const r of records) {
        if (r.target === leftField) {
          catchUp(leftField);
          return;
        }
      }
    });
    watcher.observe(document.body, { subtree: true, attributeFilter: ["data-dup-error"] });

    function onHold(e: KeyboardEvent) {
      if (e.isComposing) return; // an IME candidate-commit Enter is not movement
      // Anything that is not a plain movement key — typing, Backspace, Home/End,
      // Esc, F2, Ins, Ctrl+S, Ctrl+F, Alt+↓ — means the operator is doing
      // something else now, so the catch-up stands down (see `forget` above).
      if (!HOLD_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
        forget();
        return;
      }
      const el = heldField();
      if (!el) {
        // No error on this field YET — but one may be in flight for it. Note
        // where the cursor is leaving from, before the browser moves it.
        const active = document.activeElement;
        leftField = active instanceof HTMLElement ? active : null;
        leftAt = Date.now();
        return;
      }
      // Standing on a held field, no departure to remember.
      forget();

      // ←/→ are the only keys that do two jobs. Refusing them outright would
      // make the field un-editable, which defeats the whole point — so use the
      // same edge predicate `arrowNavigate` does, and the hold and the movement
      // rule can never disagree about where the edge is.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!atCaretEdge(el, e.key === "ArrowRight" ? "next" : "prev")) return;
      }
      // ↓ on a list-bearing control OPENS its list — that is not leaving the
      // field. Defence in depth; no duplicate-checked field is one today.
      if (
        e.key === "ArrowDown" &&
        (el.matches("[data-field-trigger]") || el.getAttribute("role") === "combobox")
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      refuse(el, el.getAttribute("data-dup-error") ?? "");
    }

    window.addEventListener("keydown", onHold, true);
    window.addEventListener("pointerdown", forget, true);
    return () => {
      window.removeEventListener("keydown", onHold, true);
      window.removeEventListener("pointerdown", forget, true);
      watcher.disconnect();
    };
  }, []);

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
      // pickers, the search palette) already calls preventDefault, so honouring
      // this is what keeps them working untouched.
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
      enterAdvances(e, root, {
        // `has` is probed BEFORE Enter claims the key at all — see the gate in
        // enterAdvances. Firing to find out would save the record.
        has: () => shortcutsRef.current?.has("save") ?? false,
        fire: () => shortcutsRef.current?.fire("save") ?? false,
      });
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

  return (
    <>
      {children}
      {/* Announces a REFUSED keypress. The message under the field carries
          role="alert" and announces when it appears, but blocking a key while
          it is already on screen produces nothing new to read. Always mounted:
          a live region only announces nodes inserted while it is already in
          the accessibility tree (the same lesson as components/ui/toast.tsx). */}
      <span ref={liveRef} role="status" aria-live="assertive" className="sr-only" />
    </>
  );
}
